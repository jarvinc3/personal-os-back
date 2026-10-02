export type EmailSendInput = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailSenderPort {
  send(input: EmailSendInput): Promise<void>;
}
