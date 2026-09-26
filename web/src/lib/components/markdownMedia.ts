// Animated artifacts in Markdown: the source text only carries a URL, so the artifact
// extension is the only signal available — the same reason the upload pipeline names
// artifacts `.webp` / `.webm` (GIF and video/* both come out as VP9 WebM).

/** True when the URL points at a WebM artifact (GIF → VP9, or real video). */
export function isAnimatedArtifact(url: string | null | undefined): boolean {
  if (!url) return false;
  let path: string;
  try {
    // Base makes relative/protocol-relative URLs resolvable; query and hash
    // never carry the extension.
    path = new URL(url, 'https://infoto.invalid/').pathname;
  } catch {
    return false;
  }
  return path.toLowerCase().endsWith('.webm');
}

/** In-place upgrade of rendered Markdown: markdown-it emits `![alt](url)` as <img>,
 *  which cannot play WebM. Runs after DOMPurify, so only the already-vetted src (and
 *  alt) is carried over onto the <video> built outside the sanitizer's allowlist. */
export function upgradeAnimatedMedia(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src');
    if (!isAnimatedArtifact(src)) continue;
    const video = document.createElement('video');
    video.src = src ?? '';
    video.autoplay = true;
    video.loop = true;
    // Muted autoplay is the only autoplay browsers allow — matches the GIF
    // semantics most announcements want. Click unmutes real video.
    video.muted = true;
    video.playsInline = true;
    video.className = 'markdown-video';
    const alt = img.getAttribute('alt');
    if (alt) video.setAttribute('aria-label', alt);
    video.addEventListener('click', () => {
      video.muted = !video.muted;
      // Unmuting a playing element can pause it in some browsers.
      void video.play().catch(() => undefined);
    });
    img.replaceWith(video);
  }
}
