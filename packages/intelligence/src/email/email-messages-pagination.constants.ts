import { MAX_PAGE_LIMIT } from '@personal-os/core';

/**
 * Tamaño de página por defecto del listado de correos importados. Se mantiene
 * el que ya devolvía el endpoint cuando la web no envía `limit`.
 */
export const EMAIL_MESSAGES_DEFAULT_PAGE_SIZE = 50;

/** Tope compartido con el resto de listados por cursor del API. */
export const EMAIL_MESSAGES_MAX_PAGE_SIZE = MAX_PAGE_LIMIT;

export const INVALID_EMAIL_MESSAGES_LIMIT_MESSAGE = `limit debe ser un entero entre 1 y ${EMAIL_MESSAGES_MAX_PAGE_SIZE}`;
