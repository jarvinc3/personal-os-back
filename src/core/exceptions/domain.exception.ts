import { HttpException, HttpStatus } from '@nestjs/common';

export class DomainException extends HttpException {
  readonly code: string;

  constructor(
    code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        statusCode: status,
        error: code,
        message,
      },
      status,
    );
    this.code = code;
  }
}
