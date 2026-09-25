// Command hub keeps the (single) connection to the robot and shares it with
// any number of devices through a web interface. The robot only accepts one
// controlling connection at a time, so devices never talk to it directly:
// they all talk to the hub, and connecting a new device never disconnects the
// others.
//
// If another hub is already running on the network, a new one will not
// connect to the robot (that would steal the connection) and just prints the
// address of the existing hub instead.
package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	robomaster "github.com/brunoga/robomaster"
	"github.com/brunoga/robomaster/module"
	"github.com/brunoga/robomaster/module/camera"
	"github.com/brunoga/robomaster/module/chassis"
	"github.com/brunoga/robomaster/module/controller"
	"github.com/brunoga/robomaster/module/gun"
	"github.com/brunoga/robomaster/support"
	"github.com/brunoga/robomaster/support/logger"
)

//go:embed index.html
var indexHTML []byte

// React interface, built with `npm run build` in the web directory.
//
//go:embed all:web/dist
var webDist embed.FS

const (
	hubAnnouncePort   = 45680
	hubAnnouncePrefix = "RMHUB "

	// Movement stops automatically if no device refreshed it recently, so a
	// device that disappears mid-command can not leave the robot running.
	commandTimeout = 400 * time.Millisecond

	// A device is considered connected if it polled status recently.
	deviceTimeout = 5 * time.Second
)

var (
	addr       = flag.String("addr", ":8765", "HTTP address to listen on.")
	appID      = flag.Uint64("appid", support.AnyAppID, "Robot app ID (0 = first robot found).")
	wifiDirect = flag.Bool("wifidirect", false, "Connect using WiFi Direct instead of router mode.")
	fps        = flag.Int("fps", 15, "Maximum video frames per second sent to devices.")
	debug      = flag.Bool("debug", false, "Enable debug logging.")
)

type hub struct {
	c *robomaster.Client

	m             sync.Mutex
	chassisUntil  time.Time
	chassisMoving bool
	gimbalUntil   time.Time
	gimbalMoving  bool
	devices       map[string]time.Time

	frameM    sync.Mutex
	frameCond *sync.Cond
	frame     []byte
	frameSeq  uint64
	lastFrame time.Time
	viewers   int
}

func main() {
	flag.Parse()

	if other := findOtherHub(2500 * time.Millisecond); other != "" {
		fmt.Printf("A hub is already connected to the robot: open http://%s\n", other)
		fmt.Println("Not connecting to the robot, so the devices already connected stay connected.")
		return
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Could not listen on %s (is a hub already running on this computer?): %v\n", *addr, err)
		os.Exit(1)
	}

	level := slog.LevelError
	if *debug {
		level = slog.LevelDebug
	}
	l := logger.New(level)

	modules := module.TypeConnection | module.TypeRobot | module.TypeController |
		module.TypeChassis | module.TypeGimbal | module.TypeGun | module.TypeCamera

	var c *robomaster.Client
	if *wifiDirect {
		c, err = robomaster.NewWifiDirectWithModules(l, modules)
	} else {
		c, err = robomaster.NewWithModules(l, *appID, modules)
	}
	if err != nil {
		panic(err)
	}

	fmt.Println("Looking for the robot...")
	if err := c.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Could not connect to the robot: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Connected to the robot.")

	if err := c.Controller().SetMode(controller.ModeSDK); err != nil {
		fmt.Fprintf(os.Stderr, "Could not set SDK mode: %v\n", err)
	}

	h := &hub{c: c, devices: make(map[string]time.Time)}
	h.frameCond = sync.NewCond(&h.frameM)

	if _, err := c.Camera().AddVideoCallback(h.onFrame); err != nil {
		fmt.Fprintf(os.Stderr, "Video not available: %v\n", err)
	}

	go h.watchdog()

	port := ln.Addr().(*net.TCPAddr).Port
	go announce(port)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	})
	mux.Handle("GET /app/", webApp())
	mux.HandleFunc("GET /api/status", h.handleStatus)
	mux.HandleFunc("POST /api/chassis/speed", h.handleChassisSpeed)
	mux.HandleFunc("POST /api/chassis/stop", h.handleChassisStop)
	mux.HandleFunc("POST /api/gimbal/speed", h.handleGimbalSpeed)
	mux.HandleFunc("POST /api/gimbal/reset", h.handleGimbalReset)
	mux.HandleFunc("POST /api/gun/fire", h.handleGunFire)
	mux.HandleFunc("GET /video.mjpeg", h.handleVideo)

	for _, ip := range localIPs() {
		fmt.Printf("Devices can connect at http://%s:%d\n", ip, port)
	}

	go func() {
		if err := http.Serve(ln, mux); err != nil && !errors.Is(err, net.ErrClosed) {
			fmt.Fprintf(os.Stderr, "HTTP server error: %v\n", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig

	fmt.Println("Stopping...")
	ln.Close()
	c.Chassis().StopMovement(chassis.ModeAngularVelocity)
	c.Gimbal().StopRotation()
	c.Controller().SetMode(controller.ModeFPV)
	c.Stop()
}

// findOtherHub listens for announcements from another hub for up to the given
// duration and returns its address, or "" if none was found.
func findOtherHub(d time.Duration) string {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{Port: hubAnnouncePort})
	if err != nil {
		// Port already taken: another hub is running on this computer.
		return fmt.Sprintf("localhost%s", *addr)
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(d))
	buf := make([]byte, 256)
	for {
		n, src, err := conn.ReadFromUDP(buf)
		if err != nil {
			return ""
		}
		msg := string(buf[:n])
		if strings.HasPrefix(msg, hubAnnouncePrefix) {
			return fmt.Sprintf("%s:%s", src.IP, strings.TrimPrefix(msg, hubAnnouncePrefix))
		}
	}
}

// announce periodically broadcasts the hub presence so other hubs do not try
// to connect to the robot.
func announce(port int) {
	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.IPv4bcast, Port: hubAnnouncePort})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Hub announcement disabled: %v\n", err)
		return
	}
	defer conn.Close()

	msg := []byte(fmt.Sprintf("%s%d", hubAnnouncePrefix, port))
	for {
		conn.Write(msg)
		time.Sleep(1 * time.Second)
	}
}

func localIPs() []string {
	var ips []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipNet, ok := a.(*net.IPNet); ok && !ipNet.IP.IsLoopback() && ipNet.IP.To4() != nil {
			ips = append(ips, ipNet.IP.String())
		}
	}
	return ips
}

func (h *hub) watchdog() {
	for range time.Tick(50 * time.Millisecond) {
		now := time.Now()

		h.m.Lock()
		stopChassis := h.chassisMoving && now.After(h.chassisUntil)
		if stopChassis {
			h.chassisMoving = false
		}
		stopGimbal := h.gimbalMoving && now.After(h.gimbalUntil)
		if stopGimbal {
			h.gimbalMoving = false
		}
		for id, seen := range h.devices {
			if now.Sub(seen) > deviceTimeout {
				delete(h.devices, id)
			}
		}
		h.m.Unlock()

		if stopChassis {
			h.c.Chassis().StopMovement(chassis.ModeAngularVelocity)
		}
		if stopGimbal {
			h.c.Gimbal().StopRotation()
		}
	}
}

func (h *hub) handleStatus(w http.ResponseWriter, r *http.Request) {
	h.m.Lock()
	if id := r.URL.Query().Get("device"); id != "" {
		h.devices[id] = time.Now()
	}
	devices := len(h.devices)
	h.m.Unlock()

	writeJSON(w, map[string]any{
		"connected": h.c.Connection().Connected(),
		"battery":   h.c.Robot().BatteryPowerPercent(),
		"devices":   devices,
		"gun":       h.c.Gun().Connected(),
	})
}

func (h *hub) handleChassisSpeed(w http.ResponseWriter, r *http.Request) {
	var req struct{ X, Y, Z float64 }
	if !readJSON(w, r, &req) {
		return
	}

	h.m.Lock()
	h.chassisUntil = time.Now().Add(commandTimeout)
	h.chassisMoving = true
	h.m.Unlock()

	replyErr(w, h.c.Chassis().SetSpeed(chassis.ModeAngularVelocity, req.X, req.Y, req.Z))
}

func (h *hub) handleChassisStop(w http.ResponseWriter, r *http.Request) {
	h.m.Lock()
	h.chassisMoving = false
	h.m.Unlock()

	replyErr(w, h.c.Chassis().StopMovement(chassis.ModeAngularVelocity))
}

func (h *hub) handleGimbalSpeed(w http.ResponseWriter, r *http.Request) {
	var req struct{ Pitch, Yaw int16 }
	if !readJSON(w, r, &req) {
		return
	}

	h.m.Lock()
	h.gimbalUntil = time.Now().Add(commandTimeout)
	h.gimbalMoving = true
	h.m.Unlock()

	replyErr(w, h.c.Gimbal().SetRotationSpeed(req.Pitch, req.Yaw))
}

func (h *hub) handleGimbalReset(w http.ResponseWriter, r *http.Request) {
	replyErr(w, h.c.Gimbal().ResetPosition())
}

func (h *hub) handleGunFire(w http.ResponseWriter, r *http.Request) {
	typ := gun.TypeBead
	if r.URL.Query().Get("type") == "infrared" {
		typ = gun.TypeInfrared
	}
	replyErr(w, h.c.Gun().Fire(typ))
}

// onFrame encodes frames to JPEG only when at least one device is watching,
// and shares the same encoded frame with all of them.
func (h *hub) onFrame(frame *camera.RGB) {
	h.frameM.Lock()
	if h.viewers == 0 || time.Since(h.lastFrame) < time.Second/time.Duration(*fps) {
		h.frameM.Unlock()
		return
	}
	h.lastFrame = time.Now()
	h.frameM.Unlock()

	b := frame.Bounds()
	rgba := image.NewRGBA(b)
	src, dst := frame.Pix, rgba.Pix
	for i, j := 0, 0; i+2 < len(src) && j+3 < len(dst); i, j = i+3, j+4 {
		dst[j], dst[j+1], dst[j+2], dst[j+3] = src[i], src[i+1], src[i+2], 255
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, rgba, &jpeg.Options{Quality: 70}); err != nil {
		return
	}

	h.frameM.Lock()
	h.frame = buf.Bytes()
	h.frameSeq++
	h.frameCond.Broadcast()
	h.frameM.Unlock()
}

func (h *hub) handleVideo(w http.ResponseWriter, r *http.Request) {
	const boundary = "frame"
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+boundary)
	w.Header().Set("Cache-Control", "no-cache")

	h.frameM.Lock()
	h.viewers++
	h.frameM.Unlock()
	defer func() {
		h.frameM.Lock()
		h.viewers--
		h.frameM.Unlock()
	}()

	// Wake up the wait below when the device goes away.
	done := r.Context().Done()
	go func() {
		<-done
		h.frameM.Lock()
		h.frameCond.Broadcast()
		h.frameM.Unlock()
	}()

	var seq uint64
	for {
		h.frameM.Lock()
		for h.frameSeq == seq && r.Context().Err() == nil {
			h.frameCond.Wait()
		}
		if r.Context().Err() != nil {
			h.frameM.Unlock()
			return
		}
		frame, newSeq := h.frame, h.frameSeq
		h.frameM.Unlock()
		seq = newSeq

		fmt.Fprintf(w, "--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", boundary, len(frame))
		if _, err := w.Write(frame); err != nil {
			return
		}
		w.Write([]byte("\r\n"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
}

// webApp serves the React interface under /app/. Paths that are not files
// (client-side routes such as /app/logs) get index.html.
func webApp() http.Handler {
	dist, _ := fs.Sub(webDist, "web/dist")
	files := http.StripPrefix("/app/", http.FileServerFS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/app/")
		if _, err := fs.Stat(dist, name); name != "" && err != nil {
			http.ServeFileFS(w, r, dist, "index.html")
			return
		}
		files.ServeHTTP(w, r)
	})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func replyErr(w http.ResponseWriter, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
