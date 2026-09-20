/** @import { Token, TokenDesign } from "../../designs.js" */
/** @import { PanelHooks, Source } from "./source.js" */
/** @import { Rect } from "../art-arranger.js" */
import { artBoxOf, customKind, isBlankToken, loadArt, tokenOf } from "../../designs.js";
import { bindArtArranger } from "../art-arranger.js";
import { element } from "../dom.js";

/**
 * A custom card on the label, with its image arranged right on the preview.
 * @param {object} options
 * @param {PanelHooks} options.panel
 * @param {() => { width: number, height: number } | undefined} options.page  The drawn label.
 * @param {(token: Token, fromList: boolean) => void} options.onChange  The token's image was
 *   arranged. `fromList` means it belongs to a label from the print list, not to My cards.
 * @returns {Source<TokenDesign> & { show: (token: Token) => void, clear: () => void }}
 */
export function createTokenSource({ panel, page, onChange }) {
  const ui = {
    label: element("#label", HTMLElement),
    preview: element("#preview", HTMLCanvasElement),
    arrangeHint: element("#arrange-hint", HTMLElement),
    arrangeFields: element("#arrange-fields", HTMLElement),
  };
  /** @type {Token | undefined} */
  let token;
  /** The token's image and where it is on the label, for arranging it. @type {ImageBitmap | undefined} */
  let artImage;
  /** @type {Rect | undefined} */
  let artBox;
  let arrangeFrame = 0;

  const arranger = bindArtArranger({
    canvas: ui.preview,
    target() {
      const drawn = page();
      if (!panel.isActive("token") || !drawn || !artBox || !artImage || !token?.art) return undefined;
      return { page: drawn, box: artBox, image: artImage, arrangement: token.art };
    },
    onArrange(arrangement) {
      if (!token?.art) return;
      token = { ...token, art: { ...token.art, ...arrangement } };
      onChange(token, panel.isEditing());
      cancelAnimationFrame(arrangeFrame);
      arrangeFrame = requestAnimationFrame(() => panel.refresh({ quiet: true }));
    },
  });

  /** @param {Token} next */
  function show(next) {
    const same = panel.isActive("token") && token?.id === next.id;
    token = next;
    panel.refresh({ quiet: same && panel.hasPage() });
  }

  return {
    type: "token",
    show,

    clear() {
      token = undefined;
      artBox = undefined;
    },

    design(darkness) {
      return token && { ...token, type: "token", darkness };
    },

    heading() {
      return { name: token?.name.trim() || "New card", detail: token ? customKind(token) : "" };
    },

    empty: () => !token || isBlankToken(token),

    usesDarkness: () => Boolean(token?.art),

    showOptions(active) {
      ui.arrangeFields.hidden = !(active && token?.art);
      // The image can be dragged on the preview, and focused to move it with keys.
      const arrangeable = active && Boolean(artBox);
      ui.label.classList.toggle("arrangeable", arrangeable);
      ui.arrangeHint.hidden = !arrangeable;
      if (arrangeable) ui.preview.tabIndex = 0;
      else ui.preview.removeAttribute("tabindex");
      if (arrangeable && token?.art) arranger.sync(token.art);
    },

    load(saved) {
      show(tokenOf(saved));
    },

    options: () => undefined,
    restoreOptions() {},

    async rendered(design, media) {
      artImage = design.art ? await loadArt(design.art) : undefined;
      artBox = artImage ? artBoxOf(design, media) : undefined;
    },
  };
}
