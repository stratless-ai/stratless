/**
 * Replaces `sharp` (25MB of image codecs) at bundle time. Only transformers' utils/image.js
 * imports it, and the text-embedding path never constructs an image. A loud Proxy rather than an
 * empty object: if a future transformers version ever reaches for image work on our path, the
 * error names the cause instead of failing somewhere downstream.
 */
export default new Proxy(
  {},
  {
    get() {
      throw new Error('sharp is stubbed out of @stratless/runtime — image paths are unsupported by design');
    },
  },
);
