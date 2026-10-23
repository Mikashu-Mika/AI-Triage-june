-- ==============================================================================
-- Data fix: 13 chats had their summary overwritten by "Triage failed: ..." (old error handling)
-- and were then marked completed, so the executive bot showed the error text as a chat summary.
-- Setting them back to pending lets the server re-classify them (requires Ollama running).
-- ==============================================================================

UPDATE chats
SET status = 'pending', summary = NULL
WHERE summary LIKE 'Triage failed:%';
