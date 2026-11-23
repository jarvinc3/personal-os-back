import type { EmailProductProposalDraft } from '@personal-os/contracts';

export type ProposalStatus = 'PENDING' | 'APPROVING' | 'APPROVED' | 'DISCARDED';

export type ProposalRow = {
  id: string;
  userId: string;
  status: ProposalStatus;
  productType: 'ACCOUNT' | 'CARD';
  draft: unknown;
  approvedProductId: string | null;
};

export type ProposalDiscoverySummary = {
  scanned: number;
  limit: number;
  limitReached: boolean;
  created: number;
  evidenceAdded: number;
  ignored: number;
  alreadyExists: number;
  ambiguous: number;
};

export type ProposalEvidenceView = {
  messageId: string;
  fromDomain: string;
  subject: string;
  receivedAt: string;
  match: unknown;
  createdAt: string;
};

export type ProposalDraftView = Omit<
  EmailProductProposalDraft,
  'accountNumberCiphertext' | 'accountNumberHash'
> & {
  accountNumberProvided: boolean;
  institution: EmailProductProposalDraft['institution'] & {
    matchedInstitutionId: string | null;
    matchedInstitutionIds: string[];
  };
};

export type ProposalView = {
  id: string;
  productType: 'ACCOUNT' | 'CARD';
  status: ProposalStatus;
  matchedProductId: string | null;
  matchedProductIds: string[];
  draft: ProposalDraftView;
  approvedProductId: string | null;
  createdAt: string;
  evidence: ProposalEvidenceView[];
};

export type ProposalApprovalView = ProposalView & {
  approval?: {
    duplicate: boolean;
    productId: string;
    reevaluatedSignals: number;
  };
};

export type ProposalDiscoveryView = ProposalDiscoverySummary & {
  proposals: ProposalView[];
};
