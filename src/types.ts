import type { Draft, Release } from "../shared/model";
export type Project = {
  id: string;
  publicId: string;
  name: string;
  clientName: string;
  lifecycle: string;
  sharing: boolean;
  revision: number;
  draft: Draft;
  currentRelease: Release | null;
  updatedAt: string;
  entitlement: {
    state: string;
    expiresAt: number | null;
    graceUntil: number | null;
    limits: {
      guides: number;
      steps: number;
      storage: number;
      ai: number;
      exports: number;
    };
    aiRemaining: number;
    exportsUsed: number;
    storage: number;
  };
  openQuestions: number;
  confirmation: any;
};
export type Session = {
  user: null | {
    id: string;
    email: string;
    workspaceId: string | null;
    csrf: string;
    verifiedAt: number;
    settings: {
      name: string;
      timezone: string;
      supportEmail: string;
      expiryReminders: boolean;
    };
  };
  localMode: boolean;
  aiEnabled: boolean;
  aiNotice: string;
  billingEnabled: boolean;
  supportEmail: string;
};
