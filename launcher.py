#!/usr/bin/env python3
"""
Cross-Platform Launcher for Momentum Trader Charts
Launches both the Python backend and Electron frontend

Supports headless operation (no console window) with file logging.
"""
import subprocess
import sys
import time
import platform
import signal
import os
import atexit
import logging
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

# Global for signal handler access
_launcher = None
_logger = None
_headless = False


def setup_logging(base_dir: Path):
    """Setup file logging for headless operation"""
    global _logger, _headless

    log_dir = base_dir / 'logs'
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / 'launcher.log'

    # Configure file logging
    logging.basicConfig(
        filename=str(log_file),
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    _logger = logging.getLogger('launcher')

    # Detect if running headless (pythonw on Windows, or no stdout)
    _headless = (
        not sys.stdout or
        not hasattr(sys.stdout, 'write') or
        (platform.system() == 'Windows' and 'pythonw' in sys.executable.lower())
    )

    return _logger


def log(msg):
    """Log to file and console (if available)"""
    global _logger, _headless

    # Always log to file if logger is configured
    if _logger:
        _logger.info(msg)

    # Also print to console if not headless
    if not _headless:
        try:
            print(msg, flush=True)
        except Exception:
            pass  # Ignore print errors in headless mode


class ChartingLauncher:
    def __init__(self):
        self.platform = platform.system()  # 'Darwin', 'Windows', 'Linux'
        self.base_dir = Path(__file__).parent
        self.backend_dir = self.base_dir / 'backend'
        self.venv_path = self.backend_dir / 'venv'
        self.backend_process = None
        self.vite_process = None
        self.electron_process = None

        # Platform-specific configuration
        if self.platform == 'Windows':
            self.python_exe = self.venv_path / 'Scripts' / 'python.exe'
        else:  # macOS and Linux
            self.python_exe = self.venv_path / 'bin' / 'python'

        # Check if using system Python or venv
        if not self.python_exe.exists():
            self.python_exe = sys.executable
            log(f"[!] Virtual environment not found, using system Python: {self.python_exe}")

    def cleanup_stale_processes(self):
        """Kill any stale processes from a previous run that didn't exit cleanly"""
        if self.platform != 'Windows':
            return

        charting_ports = [8081, 5173]
        for port in charting_ports:
            try:
                result = subprocess.run(
                    ['netstat', '-ano'],
                    capture_output=True, text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
                for line in result.stdout.splitlines():
                    if f':{port}' in line and 'LISTENING' in line:
                        parts = line.split()
                        pid = int(parts[-1])
                        if pid == 0:
                            continue
                        log(f"[!] Found stale process on port {port} (PID {pid}), killing...")
                        subprocess.run(
                            ['taskkill', '/F', '/PID', str(pid)],
                            capture_output=True,
                            creationflags=subprocess.CREATE_NO_WINDOW
                        )
                        log(f"[OK] Killed stale PID {pid}")
                        time.sleep(0.5)  # Let port release
            except Exception as e:
                log(f"[!] Error cleaning stale processes on port {port}: {e}")

    def check_requirements(self):
        """Check if required files exist"""
        backend_main = self.backend_dir / 'main.py'
        if not backend_main.exists():
            log(f"[X] Error: backend/main.py not found at {backend_main}")
            log(f"    Please run this launcher from the momentum-trader-charting directory")
            return False

        package_json = self.base_dir / 'package.json'
        if not package_json.exists():
            log(f"[X] Error: package.json not found at {package_json}")
            return False

        return True

    def wait_for_backend(self, timeout=30):
        """Wait for backend to be ready"""
        log("Waiting for backend to start...")
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                response = urlopen('http://localhost:8081/api/health', timeout=2)
                if response.status == 200:
                    log("[OK] Backend is ready")
                    return True
            except (URLError, Exception):
                pass

            # Check if process died
            if self.backend_process and self.backend_process.poll() is not None:
                log("[X] Backend process terminated unexpectedly")
                return False

            time.sleep(0.5)

        log("[!] Backend startup timeout, continuing anyway...")
        return True

    def start_backend(self):
        """Start the Python backend server"""
        log("=" * 60)
        log("[START] Starting Momentum Trader Charts")
        log("=" * 60)
        log(f"Platform: {self.platform}")
        log(f"Python: {self.python_exe}")
        log(f"Working Directory: {self.base_dir}")
        log("")

        try:
            log("Starting backend server...")

            # Platform-specific process creation
            if self.platform == 'Windows':
                # On Windows, use CREATE_NO_WINDOW to hide the subprocess window
                # But keep our own window visible for logs
                self.backend_process = subprocess.Popen(
                    [str(self.python_exe), 'main.py'],
                    cwd=str(self.backend_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    bufsize=1,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
            else:
                self.backend_process = subprocess.Popen(
                    [str(self.python_exe), 'main.py'],
                    cwd=str(self.backend_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    bufsize=1
                )

            # Wait for backend to be ready
            if not self.wait_for_backend():
                return False

            return True

        except Exception as e:
            log(f"[X] Failed to start backend: {e}")
            return False

    def wait_for_vite(self, timeout=30):
        """Wait for Vite dev server to be ready"""
        log("Waiting for Vite dev server...")
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                response = urlopen('http://localhost:5173', timeout=2)
                if response.status == 200:
                    log("[OK] Vite dev server is ready")
                    return True
            except (URLError, Exception):
                pass

            # Check if process died
            if self.vite_process and self.vite_process.poll() is not None:
                log("[X] Vite process terminated unexpectedly")
                return False

            time.sleep(0.5)

        log("[!] Vite startup timeout, continuing anyway...")
        return True

    def start_vite(self):
        """Start the Vite dev server"""
        try:
            log("Starting Vite dev server...")

            if self.platform == 'Windows':
                self.vite_process = subprocess.Popen(
                    ['cmd', '/c', 'npm', 'run', 'dev:renderer'],
                    cwd=str(self.base_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    bufsize=1,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
            else:
                self.vite_process = subprocess.Popen(
                    ['npm', 'run', 'dev:renderer'],
                    cwd=str(self.base_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    bufsize=1
                )

            # Wait for Vite to be ready
            if not self.wait_for_vite():
                return False

            return True

        except Exception as e:
            log(f"[X] Failed to start Vite: {e}")
            return False

    def start_electron(self):
        """Start the Electron app"""
        try:
            log("Starting Electron app...")

            # Set environment variable so Electron knows to connect to dev server
            env = os.environ.copy()
            env['NODE_ENV'] = 'development'

            if self.platform == 'Windows':
                self.electron_process = subprocess.Popen(
                    ['cmd', '/c', 'npm', 'run', 'electron'],
                    cwd=str(self.base_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    bufsize=1,
                    env=env,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
            else:
                self.electron_process = subprocess.Popen(
                    ['npm', 'run', 'electron'],
                    cwd=str(self.base_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    bufsize=1,
                    env=env
                )

            log("[OK] Electron app started")
            return True

        except Exception as e:
            log(f"[X] Failed to start Electron: {e}")
            return False

    def wait_for_exit(self):
        """Wait for the Electron process to end or user interrupt"""
        log("")
        log("=" * 60)
        log("Momentum Trader Charts is running!")
        log("=" * 60)
        log("Backend: http://localhost:8081")
        log("Frontend: http://localhost:5173")
        log("")
        log("Close the Electron window or press Ctrl+C to stop")
        log("=" * 60)
        log("")

        try:
            # Monitor Electron process - when it exits, we shut down
            while True:
                # Check if Electron process has ended
                if self.electron_process and self.electron_process.poll() is not None:
                    log("")
                    log("Electron closed, shutting down...")
                    break

                # Read any output from electron process
                if self.electron_process and self.electron_process.stdout:
                    try:
                        # Non-blocking read would be better, but this works
                        import select
                        if self.platform != 'Windows':
                            readable, _, _ = select.select([self.electron_process.stdout], [], [], 0.5)
                            if readable:
                                line = self.electron_process.stdout.readline()
                                if line:
                                    log(f"[Electron] {line.strip()}")
                        else:
                            time.sleep(0.5)
                    except Exception:
                        time.sleep(0.5)

                time.sleep(0.1)

        except KeyboardInterrupt:
            log("")
            log("=" * 60)
            log("Shutting down (Ctrl+C received)...")
            log("=" * 60)

    def shutdown_backend(self):
        """Shutdown backend via API call"""
        try:
            from urllib.request import Request
            req = Request('http://localhost:8081/api/shutdown', method='POST')
            urlopen(req, timeout=2)
            log("[OK] Backend shutdown signal sent")
            return True
        except Exception:
            return False

    def cleanup(self):
        """Clean up and terminate all processes"""
        # Guard against double-cleanup (atexit + explicit call)
        if getattr(self, '_cleaned_up', False):
            return
        self._cleaned_up = True

        log("Cleaning up processes...")

        # Try to shutdown backend gracefully via API (short timeout - don't wait if hung)
        self.shutdown_backend()

        # FIRST: Kill anything on our ports - this is the most reliable method
        # The backend might be hung (can't respond to shutdown), or might have spawned
        # a child process with a different PID than proc.pid
        if self.platform == 'Windows':
            self._kill_port_holders([8081, 5173])
            time.sleep(0.3)  # Let ports release

        # Then try to kill our tracked processes (for stdout cleanup, etc.)
        for name, proc in [
            ('Electron', self.electron_process),
            ('Vite', self.vite_process),
            ('Backend', self.backend_process),
        ]:
            if proc and proc.poll() is None:
                try:
                    if self.platform == 'Windows':
                        subprocess.run(
                            ['taskkill', '/F', '/PID', str(proc.pid)],
                            capture_output=True,
                            creationflags=subprocess.CREATE_NO_WINDOW
                        )
                    else:
                        proc.terminate()
                        try:
                            proc.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                    log(f"[OK] {name} stopped (PID {proc.pid})")
                except Exception as e:
                    log(f"[!] Error stopping {name}: {e}")

        # Final safety pass: ensure ports are really freed
        if self.platform == 'Windows':
            self._kill_port_holders([8081, 5173])

        log("")
        log("=" * 60)
        log("Momentum Trader Charts stopped")
        log("=" * 60)

    def _kill_port_holders(self, ports):
        """Kill any process holding our ports - essential for cleanup when backend is hung"""
        try:
            result = subprocess.run(
                ['netstat', '-ano'],
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            for port in ports:
                for line in result.stdout.splitlines():
                    if f':{port}' in line and 'LISTENING' in line:
                        parts = line.split()
                        pid = int(parts[-1])
                        if pid == 0:
                            continue
                        log(f"[!] Port {port} held by PID {pid}, killing...")
                        kill_result = subprocess.run(
                            ['taskkill', '/F', '/PID', str(pid)],
                            capture_output=True, text=True,
                            creationflags=subprocess.CREATE_NO_WINDOW
                        )
                        if kill_result.returncode == 0:
                            log(f"[OK] Killed PID {pid} (was holding port {port})")
                        else:
                            # taskkill may fail if process already gone
                            log(f"[!] Could not kill PID {pid}: {kill_result.stderr.strip() or 'unknown error'}")
        except Exception as e:
            log(f"[!] Error in port cleanup: {e}")

    def run(self):
        """Main launcher workflow"""
        global _launcher
        _launcher = self

        # Setup logging first (for headless operation)
        setup_logging(self.base_dir)

        # Register atexit handler so cleanup runs even on abnormal exit
        atexit.register(self.cleanup)

        # Setup signal handlers
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        # Check requirements
        if not self.check_requirements():
            return 1

        # Kill any stale processes from previous run
        self.cleanup_stale_processes()

        # Start backend
        if not self.start_backend():
            self.cleanup()
            return 1

        # Start Vite dev server
        if not self.start_vite():
            self.cleanup()
            return 1

        # Start Electron app
        if not self.start_electron():
            self.cleanup()
            return 1

        # Wait for exit
        self.wait_for_exit()

        # Cleanup
        self.cleanup()

        return 0


def signal_handler(signum, frame):
    """Handle shutdown signals"""
    global _launcher
    if _launcher:
        log("")
        log(f"Received signal {signum}, shutting down...")
        _launcher.cleanup()
    sys.exit(0)


def main():
    """Entry point for the launcher"""
    launcher = ChartingLauncher()
    exit_code = launcher.run()
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
