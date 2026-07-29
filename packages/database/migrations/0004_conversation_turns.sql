CREATE TABLE game.conversations (
  conversation_id uuid PRIMARY KEY,
  user_id text NOT NULL CHECK (btrim(user_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX conversations_user_idx ON game.conversations(user_id, created_at DESC);

CREATE TABLE game.conversation_turns (
  turn_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id text NOT NULL CHECK (btrim(user_id) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_hash text NOT NULL CHECK (btrim(request_hash) <> ''),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  authoritative_response jsonb,
  player_safe_response jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (conversation_id, user_id)
    REFERENCES game.conversations(conversation_id, user_id) ON DELETE CASCADE,
  UNIQUE (user_id, conversation_id, idempotency_key),
  CHECK (
    (status = 'pending' AND authoritative_response IS NULL AND player_safe_response IS NULL
      AND error_code IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND authoritative_response IS NOT NULL AND player_safe_response IS NOT NULL
      AND error_code IS NULL AND completed_at IS NOT NULL)
    OR
    (status = 'failed' AND authoritative_response IS NULL AND player_safe_response IS NULL
      AND error_code IS NOT NULL AND btrim(error_code) <> '' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX conversation_turns_history_idx
  ON game.conversation_turns(user_id, conversation_id, created_at DESC, turn_id DESC)
  WHERE status = 'completed';
