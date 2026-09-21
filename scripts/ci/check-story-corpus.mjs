import { STORY_CERTIFICATION_CASES } from "./story-certification-corpus.mjs";
import {
  storyCampaignSummary,
  validateStoryCorpus,
} from "./story-certification-audit.mjs";

const errors = validateStoryCorpus(STORY_CERTIFICATION_CASES);
const summary = storyCampaignSummary(STORY_CERTIFICATION_CASES);
console.log(JSON.stringify({ ...summary, valid: errors.length === 0, errors }, null, 2));
if (errors.length > 0) {
  process.exitCode = 1;
} else {
  console.log(
    "Story manifests are valid specifications. No player actions or live narration were executed.",
  );
}
