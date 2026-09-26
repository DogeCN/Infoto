// Shared manifest for the local-DB seeding workflow.
//
// `name` is the on-disk filename of the *raw* download under scripts/seed-media/.
// `type` is the photos.type code the upload pipeline would assign:
//   0 = still image → transcoded to WebP
//   1 = animated image (GIF) → transcoded to WebM (no audio)
//   2 = video with audio      → transcoded to WebM (with audio)
// The transcode step (`scripts/transcode-seed-media.mjs`) reads this list, converts
// each raw file to the pipeline's output format, and writes it to
// scripts/seed-media/transcoded/<base>.(webp|webm). The seed script then uploads
// those transcoded artifacts instead of the raw bytes.
//
// `w`/`h` are only the requested download dimensions (picsum / placehold are exact);
// the final dimensions inserted into the DB come from ffprobe on the transcoded file.
// `uploader` is which seeded identity uploads the file (root / A / B / C).
// `urls` are candidate download sources; the first that returns bytes wins.

export const MEDIA = [
  // --- images (type 0) --------------------------------------------------------
  {
    name: 'img-1.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1280,
    h: 853,
    uploader: 'root',
    urls: ['https://picsum.photos/seed/infoto1/1280/853', 'https://placehold.co/1280x853/png'],
  },
  {
    name: 'img-2.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 853,
    h: 1280,
    uploader: 'A',
    urls: ['https://picsum.photos/seed/infoto2/853/1280', 'https://placehold.co/853x1280/png'],
  },
  {
    name: 'img-3.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1000,
    h: 1000,
    uploader: 'root',
    urls: ['https://picsum.photos/seed/infoto3/1000/1000', 'https://placehold.co/1000x1000/png'],
  },
  {
    name: 'img-4.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1600,
    h: 500,
    uploader: 'B',
    urls: ['https://picsum.photos/seed/infoto4/1600/500', 'https://placehold.co/1600x500/png'],
  },
  {
    name: 'img-5.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 500,
    h: 1100,
    uploader: 'root',
    urls: ['https://picsum.photos/seed/infoto5/500/1100', 'https://placehold.co/500x1100/png'],
  },
  {
    name: 'img-6.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1920,
    h: 1080,
    uploader: 'root',
    urls: ['https://picsum.photos/seed/infoto6/1920/1080', 'https://placehold.co/1920x1080/png'],
  },
  {
    name: 'img-7.png',
    type: 0,
    mime: 'image/png',
    w: 640,
    h: 640,
    uploader: 'A',
    urls: ['https://picsum.photos/seed/infoto7/640/640', 'https://placehold.co/640x640/png'],
  },
  {
    name: 'img-8.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 900,
    h: 1200,
    uploader: 'B',
    urls: ['https://picsum.photos/seed/infoto8/900/1200', 'https://placehold.co/900x1200/png'],
  },
  {
    name: 'img-9.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1400,
    h: 700,
    uploader: 'root',
    urls: ['https://picsum.photos/seed/infoto9/1400/700', 'https://placehold.co/1400x700/png'],
  },
  {
    name: 'img-10.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 480,
    h: 800,
    uploader: 'C',
    urls: ['https://picsum.photos/seed/infoto10/480/800', 'https://placehold.co/480x800/png'],
  },
  {
    name: 'img-11.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 800,
    h: 500,
    uploader: 'A',
    urls: ['https://picsum.photos/seed/infoto11/800/500', 'https://placehold.co/800x500/png'],
  },
  {
    name: 'img-12.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 600,
    h: 900,
    uploader: 'B',
    urls: ['https://picsum.photos/seed/infoto12/600/900', 'https://placehold.co/600x900/png'],
  },
  {
    name: 'img-13.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1500,
    h: 1000,
    uploader: 'root',
    urls: ['https://picsum.photos/seed/infoto13/1500/1000', 'https://placehold.co/1500x1000/png'],
  },
  {
    name: 'img-14.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 700,
    h: 700,
    uploader: 'C',
    urls: ['https://picsum.photos/seed/infoto14/700/700', 'https://placehold.co/700x700/png'],
  },
  {
    name: 'img-15.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1100,
    h: 600,
    uploader: 'A',
    urls: ['https://picsum.photos/seed/infoto15/1100/600', 'https://placehold.co/1100x600/png'],
  },
  {
    name: 'img-16.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 1200,
    h: 1500,
    uploader: 'B',
    urls: ['https://picsum.photos/seed/infoto16/1200/1500', 'https://placehold.co/1200x1500/png'],
  },
  {
    name: 'img-17.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 2000,
    h: 1200,
    uploader: 'root',
    urls: ['https://picsum.photos/seed/infoto17/2000/1200', 'https://placehold.co/2000x1200/png'],
  },
  {
    name: 'img-18.jpg',
    type: 0,
    mime: 'image/jpeg',
    w: 560,
    h: 840,
    uploader: 'C',
    urls: ['https://picsum.photos/seed/infoto18/560/840', 'https://placehold.co/560x840/png'],
  },

  // --- animated gifs (type 1) → WebM -----------------------------------------
  {
    name: 'gif-1.gif',
    type: 1,
    mime: 'image/gif',
    w: 480,
    h: 270,
    uploader: 'root',
    urls: [
      'https://media.giphy.com/media/3oEjI6SIIHBdRxVtBa/giphy.gif',
      'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif',
    ],
  },
  {
    name: 'gif-2.gif',
    type: 1,
    mime: 'image/gif',
    w: 480,
    h: 270,
    uploader: 'B',
    urls: [
      'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif',
      'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
    ],
  },

  // --- videos with audio (type 2) → WebM -------------------------------------
  {
    name: 'vid-1.mp4',
    type: 2,
    mime: 'video/mp4',
    w: 320,
    h: 176,
    uploader: 'A',
    urls: [
      'https://www.w3schools.com/html/mov_bbb.mp4',
      'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
      'https://download.samplelib.com/mp4/sample-10s.mp4',
    ],
  },
  {
    name: 'vid-2.mp4',
    type: 2,
    mime: 'video/mp4',
    w: 320,
    h: 176,
    uploader: 'C',
    urls: [
      'https://download.samplelib.com/mp4/sample-15s.mp4',
      'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
      'https://www.w3schools.com/html/mov_bbb.mp4',
    ],
  },
];
