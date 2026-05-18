import { spawn } from "node:child_process";

const processes = [];

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
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

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Backend:  http://127.0.0.1:8739");
console.log("Frontend: http://127.0.0.1:5174");

start("backend", "env3.9/bin/python", ["server.py"]);
start("frontend", "npm", ["run", "dev", "--prefix", "frontend"]);
