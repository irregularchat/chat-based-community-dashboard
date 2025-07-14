-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "password" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_moderator" BOOLEAN NOT NULL DEFAULT false,
    "date_joined" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),
    "attributes" JSONB,
    "authentik_id" TEXT,
    "signal_identity" TEXT,
    "matrix_username" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_events" (
    "id" SERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "username" TEXT,
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_settings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_bookmarks" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_announcements" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "dashboard_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matrix_room_members" (
    "id" SERIAL NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "membership" TEXT,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matrix_room_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_edited_by" TEXT,

    CONSTRAINT "user_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "email" TEXT,
    "name" TEXT,
    "groups" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "used_by" TEXT,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "authentik_group_id" TEXT,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_groups" (
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("user_id","group_id")
);

-- CreateTable
CREATE TABLE "moderator_permissions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "permission_type" TEXT NOT NULL,
    "permission_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "moderator_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matrix_users" (
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "is_signal_user" BOOLEAN NOT NULL DEFAULT false,
    "last_seen" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matrix_users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "matrix_rooms" (
    "room_id" TEXT NOT NULL,
    "name" TEXT,
    "display_name" TEXT,
    "topic" TEXT,
    "canonical_alias" TEXT,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "room_type" TEXT,
    "is_direct" BOOLEAN NOT NULL DEFAULT false,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "last_synced" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matrix_rooms_pkey" PRIMARY KEY ("room_id")
);

-- CreateTable
CREATE TABLE "matrix_cache_memberships" (
    "id" SERIAL NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "membership_status" TEXT NOT NULL DEFAULT 'join',
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matrix_cache_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matrix_sync_status" (
    "id" SERIAL NOT NULL,
    "sync_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_sync" TIMESTAMP(3),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "processed_items" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "sync_duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matrix_sync_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matrix_user_cache" (
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "is_signal_user" BOOLEAN NOT NULL DEFAULT false,
    "room_count" INTEGER NOT NULL DEFAULT 0,
    "last_activity" TIMESTAMP(3),
    "cache_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matrix_user_cache_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_authentik_id_key" ON "users"("authentik_id");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_settings_key_key" ON "dashboard_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "matrix_room_members_room_id_user_id_key" ON "matrix_room_members"("room_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE INDEX "moderator_permissions_user_id_idx" ON "moderator_permissions"("user_id");

-- CreateIndex
CREATE INDEX "moderator_permissions_permission_type_permission_value_idx" ON "moderator_permissions"("permission_type", "permission_value");

-- CreateIndex
CREATE INDEX "matrix_users_is_signal_user_idx" ON "matrix_users"("is_signal_user");

-- CreateIndex
CREATE INDEX "matrix_rooms_member_count_idx" ON "matrix_rooms"("member_count");

-- CreateIndex
CREATE INDEX "matrix_rooms_is_direct_idx" ON "matrix_rooms"("is_direct");

-- CreateIndex
CREATE INDEX "matrix_rooms_last_synced_idx" ON "matrix_rooms"("last_synced");

-- CreateIndex
CREATE INDEX "matrix_cache_memberships_room_id_idx" ON "matrix_cache_memberships"("room_id");

-- CreateIndex
CREATE INDEX "matrix_cache_memberships_user_id_idx" ON "matrix_cache_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "matrix_cache_memberships_room_id_user_id_key" ON "matrix_cache_memberships"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "matrix_sync_status_sync_type_idx" ON "matrix_sync_status"("sync_type");

-- CreateIndex
CREATE INDEX "matrix_sync_status_status_idx" ON "matrix_sync_status"("status");

-- CreateIndex
CREATE INDEX "matrix_user_cache_is_signal_user_idx" ON "matrix_user_cache"("is_signal_user");

-- CreateIndex
CREATE INDEX "matrix_user_cache_room_count_idx" ON "matrix_user_cache"("room_count");

-- AddForeignKey
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderator_permissions" ADD CONSTRAINT "moderator_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matrix_cache_memberships" ADD CONSTRAINT "matrix_cache_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "matrix_users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matrix_cache_memberships" ADD CONSTRAINT "matrix_cache_memberships_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "matrix_rooms"("room_id") ON DELETE CASCADE ON UPDATE CASCADE;
