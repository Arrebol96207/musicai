using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace ClaudioMusicLauncher
{
    internal static class Program
    {
        private sealed class ServerHandle
        {
            private volatile int readyPort;

            public ServerHandle(Process process)
            {
                Process = process;
            }

            public Process Process { get; private set; }

            public int ReadyPort
            {
                get { return readyPort; }
            }

            public void ObserveLogLine(string line)
            {
                int port = ParseReadyPort(line);
                if (port != 0) readyPort = port;
            }
        }

        [STAThread]
        private static int Main()
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string serverPath = Path.Combine(root, "server.js");

            if (!File.Exists(serverPath))
            {
                Console.WriteLine("server.js was not found. Put ClaudioMusic.exe in the project root folder.");
                Pause();
                return 1;
            }

            string nodePath = FindNode();
            if (String.IsNullOrEmpty(nodePath))
            {
                Console.WriteLine("Node.js was not found. Install Node.js first, then run this launcher again.");
                Pause();
                return 1;
            }

            using (Mutex startupMutex = new Mutex(false, "Local\\ClaudioMusicLauncherStartup"))
            {
                bool lockTaken = false;
                try
                {
                    lockTaken = WaitForStartupLock(startupMutex, 30000);
                    if (!lockTaken)
                    {
                        int waitingPort = FindExistingClaudioPort();
                        if (waitingPort != 0)
                        {
                            return OpenReadyPort(waitingPort);
                        }

                        Console.WriteLine("Another launcher is still starting Claudio Music. Please try again in a moment.");
                        Pause();
                        return 1;
                    }

                    return StartOrReuseServer(nodePath, root);
                }
                finally
                {
                    if (lockTaken) startupMutex.ReleaseMutex();
                }
            }
        }

        private static int StartOrReuseServer(string nodePath, string root)
        {
            int port = FindExistingClaudioPort();
            ServerHandle serverProcess = null;

            if (port == 0)
            {
                serverProcess = StartServer(nodePath, root);
                port = WaitForServerPort(serverProcess, 12000);
            }

            if (port == 0)
            {
                Console.WriteLine("The server did not start. Run node server.js in this folder to see the error.");
                KillStartedServer(serverProcess);
                Pause();
                return 1;
            }

            if (!IsHealthyClaudioPort(port, 1000))
            {
                Console.WriteLine("The detected Claudio Music port is no longer responding.");
                KillStartedServer(serverProcess);
                Pause();
                return 1;
            }

            string url = "http://127.0.0.1:" + port + "/";
            Console.WriteLine("Claudio Music is ready:");
            Console.WriteLine(url);
            OpenUrl(url);

            return 0;
        }

        private static void KillStartedServer(ServerHandle serverProcess)
        {
            if (serverProcess == null || serverProcess.Process == null) return;
            try
            {
                if (!serverProcess.Process.HasExited) serverProcess.Process.Kill();
            }
            catch { }
        }

        private static int OpenReadyPort(int port)
        {
            if (!IsHealthyClaudioPort(port, 1000))
            {
                Console.WriteLine("The detected Claudio Music port is no longer responding.");
                Pause();
                return 1;
            }

            string url = "http://127.0.0.1:" + port + "/";
            Console.WriteLine("Claudio Music is ready:");
            Console.WriteLine(url);
            OpenUrl(url);
            return 0;
        }

        private static bool WaitForStartupLock(Mutex startupMutex, int timeoutMs)
        {
            try
            {
                return startupMutex.WaitOne(timeoutMs);
            }
            catch (AbandonedMutexException)
            {
                return true;
            }
        }

        private static string FindNode()
        {
            string[] candidates =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
            };

            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }

            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in path.Split(Path.PathSeparator))
            {
                try
                {
                    string candidate = Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch
                {
                    // Ignore broken PATH entries.
                }
            }

            return "";
        }

        private static ServerHandle StartServer(string nodePath, string root)
        {
            string logPath = Path.Combine(root, ".claudio-launcher.log");
            var info = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "server.js",
                WorkingDirectory = root,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            var handle = new ServerHandle(process);
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!String.IsNullOrEmpty(e.Data))
                {
                    handle.ObserveLogLine(e.Data);
                    AppendLog(logPath, e.Data);
                }
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!String.IsNullOrEmpty(e.Data))
                {
                    handle.ObserveLogLine(e.Data);
                    AppendLog(logPath, e.Data);
                }
            };

            AppendLog(logPath, "Starting server with " + nodePath);
            process.Start();
            AppendLog(logPath, "Started process " + process.Id);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return handle;
        }

        private static int WaitForServerPort(ServerHandle server, int timeoutMs)
        {
            DateTime deadline = DateTime.Now.AddMilliseconds(timeoutMs);
            while (DateTime.Now < deadline)
            {
                if (server != null && server.Process.HasExited) return 0;

                int port = server == null ? 0 : server.ReadyPort;
                if (port != 0 && IsHealthyClaudioPort(port, 1000)) return port;

                Thread.Sleep(200);
            }

            return 0;
        }

        private static int FindExistingClaudioPort()
        {
            return ProbePorts();
        }

        private static int ProbePorts()
        {
            for (int port = 3000; port <= 3010; port++)
            {
                if (IsHealthyClaudioPort(port, 800)) return port;
            }

            return 0;
        }

        private static bool IsHealthyClaudioPort(int port, int timeoutMs)
        {
            try
            {
                string json = HttpGet("http://127.0.0.1:" + port + "/api/health", timeoutMs);
                return IsClaudioHealth(json);
            }
            catch
            {
                return false;
            }
        }

        private static int ParseReadyPort(string line)
        {
            Match match = Regex.Match(
                line ?? "",
                "Claudio Music is ready at http://127\\.0\\.0\\.1:(\\d+)/",
                RegexOptions.IgnoreCase
            );

            int port;
            if (match.Success && Int32.TryParse(match.Groups[1].Value, out port) && port > 0 && port <= 65535)
            {
                return port;
            }

            return 0;
        }

        private static bool IsClaudioHealth(string json)
        {
            string compact = Regex.Replace(json ?? "", "\\s+", "");
            return compact.IndexOf("\"app\":\"ClaudioMusic\"", StringComparison.OrdinalIgnoreCase) >= 0 &&
                   compact.IndexOf("\"appVersion\":", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static string HttpGet(string url, int timeoutMs)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;

            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch
            {
                Console.WriteLine("The browser did not open automatically. Copy the URL above manually.");
                Pause();
            }
        }

        private static void AppendLog(string logPath, string line)
        {
            try
            {
                File.AppendAllText(logPath, DateTime.Now.ToString("HH:mm:ss ") + line + Environment.NewLine, Encoding.UTF8);
            }
            catch
            {
                // Logging should never break launch.
            }
        }

        private static void Pause()
        {
            Console.WriteLine();
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey(true);
        }
    }
}
