import { spawn } from "node:child_process";

const processes = [];
let shuttingDown = false;

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    detached: true,
    ...options,
  });

  processes.push({ name, child });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`${name} exited${signal ? ` with signal ${signal}` : ` with code ${code}`}`);
    shutdown(code || 1);
  });

  return child;
}

function killProcessGroup(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      try {
        child.kill(signal);
      } catch {
        // Process already exited.
      }
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of processes) {
    killProcessGroup(child, "SIGTERM");
  }

  setTimeout(() => {
    for (const { child } of processes) {
      killProcessGroup(child, "SIGKILL");
    }
    process.exit(code);
  }, 1500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  shutdown(1);
});

console.log("Backend:  http://0.0.0.0:8739");
console.log("Frontend: http://0.0.0.0:5174");

start("backend", "env3.9/bin/python", [
  "-m",
  "uvicorn",
  "backend.app:app",
  "--host",
  "0.0.0.0",
  "--port",
  "8739",
  "--reload",
  "--reload-dir",
  "backend",
]);
start("frontend", "npm", ["run", "dev", "--prefix", "frontend", "--", "--host", "0.0.0.0", "--port", "5174", "--strictPort"]);
