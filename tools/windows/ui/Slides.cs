// The slides shown while the install works.
//
// Ubuntu's installer put a slideshow here and it is a good idea, but its slides are an
// advert. These teach the four things somebody needs to know ten minutes from now: what LCS
// is, how to point a client at it, where the console lives, and what survives a restart. The
// wait is the only moment in the product's life when the user has nothing else to do, so it
// is the cheapest teaching opportunity there will ever be.
//
// Each slide names the steps it belongs with, so the deck follows the install rather than
// rotating blindly: the "why Docker" slide is on screen while Docker is being installed.

using System;
using System.Collections.Generic;

namespace Lcs.Setup
{
    internal enum SlideArt
    {
        Container,
        Terminal,
        Console,
        Layers,
        Lambda,
        Storage
    }

    internal sealed class Slide
    {
        public string Title;
        public string Body;
        public string[] Code;
        public SlideArt Art;
        public string[] Steps;      // step keys this slide is the natural companion to

        public Slide(SlideArt art, string title, string body, string[] code, string[] steps)
        {
            Art = art;
            Title = title;
            Body = body;
            Code = code;
            Steps = steps;
        }
    }

    internal static class SlideDeck
    {
        public static List<Slide> Build()
        {
            var slides = new List<Slide>();

            slides.Add(new Slide(SlideArt.Container,
                "One container, every service",
                "LCS is a single local process that answers the AWS APIs - S3, Lambda, DynamoDB, SQS, RDS and the rest - on port 4566. No account, no region to pick, no bill.",
                null,
                new string[] { "checks", "image" }));

            slides.Add(new Slide(SlideArt.Layers,
                "Why it wants Docker",
                "LCS ships as one image so the version you run is the version that was tested. Docker Desktop brings the Linux kernel it needs; WSL2 is how Windows provides that.",
                null,
                new string[] { "elevate", "wsl", "docker", "daemon" }));

            slides.Add(new Slide(SlideArt.Terminal,
                "Point the AWS CLI at your laptop",
                "Anything that takes an endpoint URL works unchanged - the CLI, boto3, the JDK SDKs, Terraform. Any credentials are accepted; \"test\" is the convention.",
                new string[]
                {
                    "aws --endpoint-url http://localhost:4566 s3 mb s3://demo",
                    "make_bucket: demo"
                },
                new string[] { "launcher", "start" }));

            slides.Add(new Slide(SlideArt.Console,
                "A console, not a log file",
                "The LCS console is served by the same process as the API, so what you see in the browser is the state your code is talking to.",
                new string[] { "http://localhost:4566/_lcs/ui/" },
                new string[] { "start" }));

            slides.Add(new Slide(SlideArt.Terminal,
                "Four commands worth remembering",
                "The installer puts lcs on your PATH and in the Start Menu. Everything the container does is behind these.",
                new string[]
                {
                    "lcs up      lcs down",
                    "lcs status  lcs logs"
                },
                new string[] { "launcher" }));

            slides.Add(new Slide(SlideArt.Lambda,
                "Lambda actually runs",
                "Invocations are not stubs: LCS starts a real container per function, which is why the installer hands it the Docker socket. The same is true of RDS, ECS and EC2.",
                null,
                new string[] { "image", "daemon" }));

            slides.Add(new Slide(SlideArt.Storage,
                "Empty on every restart, unless you ask",
                "Resources live in memory by default, so each run starts from a clean account. Point LCS at a directory when you want them to survive.",
                new string[] { "lcs up -Persist %LOCALAPPDATA%\\LCS\\data" },
                new string[] { "start" }));

            return slides;
        }
    }
}
