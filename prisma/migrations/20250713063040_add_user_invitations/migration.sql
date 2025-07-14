-- CreateTable
CREATE TABLE "user_invitations" (
    "id" SERIAL NOT NULL,
    "inviter_user_id" INTEGER,
    "invitee_email" TEXT NOT NULL,
    "invitee_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invite_token" TEXT,
    "message" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_invitations_inviter_user_id_idx" ON "user_invitations"("inviter_user_id");

-- CreateIndex
CREATE INDEX "user_invitations_invitee_email_idx" ON "user_invitations"("invitee_email");

-- CreateIndex
CREATE INDEX "user_invitations_status_idx" ON "user_invitations"("status");

-- AddForeignKey
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
