-- Added by Better Auth's anonymous (guest) plugin. NULL/0 = a normal account.
ALTER TABLE "user" ADD COLUMN "isAnonymous" integer;
