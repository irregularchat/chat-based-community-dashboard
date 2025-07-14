-- CreateTable
CREATE TABLE "community_events" (
    "id" SERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,

    CONSTRAINT "community_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_events_timestamp_idx" ON "community_events"("timestamp");

-- CreateIndex
CREATE INDEX "community_events_event_type_idx" ON "community_events"("event_type");

-- CreateIndex
CREATE INDEX "community_events_is_public_idx" ON "community_events"("is_public");
