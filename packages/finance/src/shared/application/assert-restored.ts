import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ALREADY_RESTORED,
  ALREADY_RESTORED_MESSAGE,
  type RestoreResult,
} from '../domain/deletion-snapshot';

/** Maps a restore attempt to the right HTTP error when it changed nothing. */
export function assertRestored(
  result: RestoreResult,
  notFoundMessage: string,
): void {
  if (result.count > 0) {
    return;
  }
  if (result.alreadyRestored) {
    throw new ConflictException({
      code: ALREADY_RESTORED,
      message: ALREADY_RESTORED_MESSAGE,
    });
  }
  throw new NotFoundException(notFoundMessage);
}
