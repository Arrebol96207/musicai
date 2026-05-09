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
        private const string VersionQuery = "v=9";

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

            int port = FindExistingClaudioPort();
            Process serverProcess = null;

            if (port == 0)
            {
                serverProcess = StartServer(nodePath, root);
                port = WaitForServerPort(serverProcess, 12000);
            }

            if (port == 0)
            {
                port = ProbePorts();
            }

            if (port == 0)
            {
                Console.WriteLine("The server did not start. Run node server.js in this folder to see the error.");
                Pause();
                return 1;
            }

            string url = "http://127.0.0.1:" + port + "/?" + VersionQuery;
            Console.WriteLine("Claudio Music is ready:");
            Console.WriteLine(url);
            OpenUrl(url);

            return 0;
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

        private static Process StartServer(string nodePath, string root)
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
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!String.IsNullOrEmpty(e.Data)) AppendLog(logPath, e.Data);
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!String.IsNullOrEmpty(e.Data)) AppendLog(logPath, e.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return process;
        }

        private static int WaitForServerPort(Process process, int timeoutMs)
        {
            DateTime deadline = DateTime.Now.AddMilliseconds(timeoutMs);
            while (DateTime.Now < deadline)
            {
                if (process != null && process.HasExited) return 0;

                int port = ProbePorts();
                if (port != 0) return port;

                Thread.Sleep(400);
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
                try
                {
                    string json = HttpGet("http://127.0.0.1:" + port + "/api/health", 1000);
                    if (json.IndexOf("\"appVersion\":\"9\"", StringComparison.OrdinalIgnoreCase) >= 0 &&
                        json.IndexOf("frontendAiConfig", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        string now = HttpGet("http://127.0.0.1:" + port + "/api/now", 1000);
                        if (now.IndexOf("\"appVersion\":\"9\"", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            return port;
                        }
                    }
                }
                catch
                {
                    // Try the next port.
                }
            }

            return 0;
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
