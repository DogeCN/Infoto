/* =========================================================
 * shared.js 全局导出 → 页面 const 别名（shared.js 先于本文件加载，index.html 保证顺序）
 * 集中一处，避免各功能文件各自 window.xxx 取用造成遗漏/重复
 * ========================================================= */
const WEBP_QUALITY = window.WEBP_QUALITY;
const FPS_CAP = window.FPS_CAP;
const isVideoFile = window.isVideoFile;
const isGifFile = window.isGifFile;
const isPicFile = window.isPicFile;
const hasAnimatedMedia = window.hasAnimatedMedia;
const supportsAv1WebCodecs = window.supportsAv1WebCodecs;
const compressToWebp = window.compressToWebp;
const transcodeToAv1Webm = window.transcodeToAv1Webm;
const fetchWithProgress = window.fetchWithProgress;
const createDownloadProgress = window.createDownloadProgress;
const createTaskQueue = window.createTaskQueue;
const createDeleteRunner = window.createDeleteRunner;
const genPhotoId = window.genPhotoId;
