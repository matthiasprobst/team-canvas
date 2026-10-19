export const base = process.env.BASE_URL;

if (!base) {
  throw new Error('Set BASE_URL explicitly to a disposable test deployment. Browser and smoke tests create persistent canvases; do not target your working or published app.');
}
