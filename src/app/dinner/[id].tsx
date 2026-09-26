/**
 * The recipe editor, opened from a planned dinner (the entry sheet's "Edit
 * dinner"). A root route pushed over the tabs, so Back returns to the plan the
 * person came from — pushing `/dinners/[id]` would switch to the Dinners tab and
 * land Back on the recipe list instead. Same screen, different stack.
 */
export { default } from '../(app)/dinners/[id]';
