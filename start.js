import { spawn } from 'child_process';

// 启动后端服务器
const server = spawn('npm.cmd', ['run', 'server'], { stdio: 'inherit' });

// 启动Vite开发服务器
const client = spawn('npm.cmd', ['run', 'dev'], { stdio: 'inherit' });

// 处理退出信号
process.on('SIGINT', () => {
  console.log('\nShutting down servers...');
  server.kill();
  client.kill();
  process.exit();
});