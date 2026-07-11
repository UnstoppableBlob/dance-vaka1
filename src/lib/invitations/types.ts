export type PendingInvitation = {
  id: string;
  studentUsername: string;
  createdAt: Date;
};

export type InvitationFormState = {
  errors?: {
    username?: string[];
  };
  message?: string;
  success?: boolean;
  values?: {
    username?: string;
  };
};
