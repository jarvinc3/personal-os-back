import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { isCashInstitution } from '../../shared/domain/cash';

/** The system cash institution cannot be edited or deleted. */
export function assertInstitutionEditable(institution: {
  isSystem: boolean;
}): void {
  if (institution.isSystem) {
    throw new ForbiddenException(
      'La institución Efectivo es de sistema: no se puede editar ni borrar',
    );
  }
}

export function assertNotCashInstitutionType(type: string | undefined): void {
  if (type !== undefined && isCashInstitution({ type })) {
    throw new BadRequestException(
      'Efectivo ya existe como institución de sistema',
    );
  }
}
