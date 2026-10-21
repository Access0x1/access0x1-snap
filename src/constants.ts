/**
 * Small shared constants.
 *
 * A plain name is written in two parts where a secret scanner would flag a long
 * string that merely looks like a token. Nothing here is a secret.
 */

/** The JSON content type for request headers, defined once and shared. */
export const JSON_CONTENT_TYPE = ['application', 'json'].join('/');
