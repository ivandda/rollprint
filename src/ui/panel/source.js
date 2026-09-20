/** @import { Darkness, Design } from "../../designs.js" */
/** @import { Media } from "../../printers/types.js" */

/**
 * What the label panel asks of whatever the label is made from: a Scryfall card, a custom card,
 * markers. The panel owns the preview, the paper size, darkness, copies, printing and the print
 * list; a source owns its own state and the option fields that belong to it.
 * @template {Design} [D=Design]
 * @typedef {object} Source
 * @property {D["type"]} type
 * @property {(darkness: Darkness) => D | undefined} design  The label as it is now, if there is one.
 * @property {(media: Media) => { name: string, detail: string }} heading
 * @property {() => boolean} empty  Nothing to print yet.
 * @property {() => boolean} usesDarkness  Whether the darkness choice changes the label.
 * @property {(active: boolean, media: Media) => void} showOptions  Shows its fields when active,
 *   hides them otherwise. Called whenever anything about the label changed, including after a redraw.
 * @property {(design: D) => void} load  Shows a label from the print list, taking its options.
 * @property {() => unknown} options  Its option fields' values, to put back after a print list
 *   label is done with.
 * @property {(saved: unknown) => void} restoreOptions
 * @property {(target: HTMLInputElement, editing: boolean) => void} [changed]  One of the print
 *   option inputs changed. `editing` means the values belong to a print list label, not to the
 *   user's defaults.
 * @property {(design: D, media: Media) => Promise<void>} [rendered]  The label was drawn; a
 *   chance to prepare anything shown on top of it.
 */

/** Every source the panel has, by the design type it makes. */
/** @typedef {{ [T in Design["type"]]: Source<Extract<Design, { type: T }>> }} Sources */

/**
 * What a source can ask of the panel.
 * @typedef {object} PanelHooks
 * @property {(options?: { quiet?: boolean }) => void} refresh  Heading, options and preview again.
 *   `quiet` redraws without the loading state, e.g. while an image is dragged.
 * @property {() => void} refreshOptions  Only which options are shown changed.
 * @property {(type: Design["type"]) => boolean} isActive
 * @property {() => boolean} hasPage  A label is drawn.
 * @property {() => boolean} isEditing  A print list label is being changed.
 */

export {};
