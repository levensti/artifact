import { describe, expect, it, vi, afterEach } from "vitest";
import { buildSnapshot } from "@/server/web/snapshot";
import { isPublicHttpUrl } from "@/server/web/url-safety";

const PAGE = "https://example.com/blog/post?x=1";
const opts = {
  pageUrl: PAGE,
  contactEmail: null,
  proxyUrl: (u: string) => `/api/web-asset?u=${encodeURIComponent(u)}`,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSnapshot", () => {
  it("keeps markup and inline styles, strips active content", async () => {
    const html = `<!doctype html><html lang="en" class="site"><head>
      <title>Hello</title>
      <script src="/app.js"></script>
      <meta http-equiv="refresh" content="0;url=/x">
      <base href="/base/">
      <style>.a{background:url(img/bg.png)}</style>
    </head><body class="post">
      <div style="color:red" onclick="alert(1)">Hi</div>
      <a href="javascript:alert(1)">bad</a>
      <a href="/next" target="_blank">next</a>
      <a href="#sec">jump</a>
      <iframe src="https://evil.example/"></iframe>
      <noscript><img src="/tracker.gif"></noscript>
    </body></html>`;
    const snap = await buildSnapshot(html, opts);
    expect(snap.title).toBe("Hello");
    expect(snap.html).not.toContain("<script");
    expect(snap.html).not.toContain("<iframe");
    expect(snap.html).not.toContain("<base");
    expect(snap.html).not.toContain('http-equiv="refresh"');
    expect(snap.html).toMatch(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/);
    expect(snap.html).toContain("script-src 'none'");
    expect(snap.html).not.toContain("onclick");
    expect(snap.html).not.toContain("javascript:");
    expect(snap.html).not.toContain("tracker.gif");
    expect(snap.html).toContain('style="color:red"');
    expect(snap.html).toMatch(/<html[^>]*\blang="en"/);
    expect(snap.html).toMatch(/<html[^>]*\bclass="site"/);
    expect(snap.html).toContain('<body class="post"');
    expect(snap.html).toContain('href="https://example.com/next"');
    expect(snap.html).not.toContain('target="_blank"');
    expect(snap.html).toContain('href="#sec"');
    expect(snap.html).toContain("url(https://example.com/blog/img/bg.png)");
    expect(snap.html).toMatch(/<meta[^>]*name="referrer"[^>]*>/);
    expect(snap.html).toContain('content="no-referrer"');
  });

  it("resolves image sources, promotes lazy sources and normalises srcSet", async () => {
    const html = `<html><body>
      <img srcSet="/_next/a.png 1x, /_next/a@2x.png 2x" src="/a.png" loading="lazy">
      <img src="data:image/gif;base64,R0lGOD" data-src="/real.jpg">
      <video poster="/p.jpg"><source src="/v.mp4"></video>
    </body></html>`;
    const snap = await buildSnapshot(html, opts);
    expect(snap.html).toContain(
      'srcset="https://example.com/_next/a.png 1x, https://example.com/_next/a@2x.png 2x"',
    );
    expect(snap.html).not.toContain("srcSet=");
    expect(snap.html).not.toContain('loading="lazy"');
    expect(snap.html).toContain('src="https://example.com/real.jpg"');
    expect(snap.html).toContain('poster="https://example.com/p.jpg"');
    expect(snap.html).toContain('src="https://example.com/v.mp4"');
  });

  it("undoes inline hidden-until-scripted states", async () => {
    const html = `<html><body>
      <header style="visibility:hidden">Title</header>
      <p style="opacity: 0; transform: none">Fade</p>
      <div style="opacity:0.5">Half</div>
    </body></html>`;
    const snap = await buildSnapshot(html, opts);
    expect(snap.html).toContain("<header>Title</header>");
    expect(snap.html).toContain('<p style="transform: none">Fade</p>');
    expect(snap.html).toContain('style="opacity:0.5"');
  });

  it("inlines external stylesheets and proxies fonts", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://cdn.example.com/css/site.css") {
        return new Response(
          '@import "more.css";\n@font-face{font-family:X;src:url(../fonts/x.woff2) format("woff2")}\n.hero{background:url("../img/h.jpg")}',
          { status: 200, headers: { "content-type": "text/css" } },
        );
      }
      if (url === "https://cdn.example.com/css/more.css") {
        return new Response(".more{color:blue}", {
          status: 200,
          headers: { "content-type": "text/css" },
        });
      }
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const html = `<html><head>
      <link rel="stylesheet" href="https://cdn.example.com/css/site.css" media="screen">
      <link rel="stylesheet" href="https://cdn.example.com/css/missing.css">
      <link rel="icon" href="/favicon.ico">
    </head><body>x</body></html>`;
    const snap = await buildSnapshot(html, opts);
    expect(snap.html).not.toContain("<link");
    expect(snap.html).toContain('<style media="screen">');
    expect(snap.html).toContain(".more{color:blue}");
    expect(snap.html).toContain(
      "url(/api/web-asset?u=https%3A%2F%2Fcdn.example.com%2Ffonts%2Fx.woff2)",
    );
    expect(snap.html).toContain('url("https://cdn.example.com/img/h.jpg")');
    expect(snap.failedStylesheets).toEqual(["https://cdn.example.com/css/missing.css"]);
  });

  it("finds the content body inside a non-HTML envelope", async () => {
    const html = `<DOCUMENT>\n<TYPE>S-1\n<FILENAME>x.htm\n<TEXT>\n<html><head><title>Filing</title></head><body><div>Prospectus</div></body></html>\n</TEXT>\n</DOCUMENT>`;
    const snap = await buildSnapshot(html, opts);
    expect(snap.title).toBe("Filing");
    expect(snap.html).toContain("<div>Prospectus</div>");
    expect(snap.html).not.toContain("<TYPE>");
    expect(snap.html).not.toContain("x.htm");
  });
});

describe("isPublicHttpUrl", () => {
  it("accepts public http(s) and rejects everything else", () => {
    expect(isPublicHttpUrl("https://www.sec.gov/x")?.hostname).toBe("www.sec.gov");
    expect(isPublicHttpUrl("http://example.com")).not.toBeNull();
    for (const bad of [
      "ftp://example.com/x",
      "file:///etc/passwd",
      "http://localhost:3000/",
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://192.168.1.1/",
      "http://172.20.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://foo.internal/",
      "not a url",
    ]) {
      expect(isPublicHttpUrl(bad), bad).toBeNull();
    }
  });
});
