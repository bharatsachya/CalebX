/**
 * Reads and writes one user's answers across the two tabs they live in.
 *
 * The FSM sees a single flat answer map; storage keeps contact details apart,
 * per `003_contact_details.sql`. `splitAnswers`/`mergeAnswers` in `@calebx/form`
 * decide which field goes where — that routing is schema knowledge, so it stays
 * in the domain package and this file only performs the I/O.
 */

import {
  mergeAnswers,
  splitAnswers,
  type Answers,
  type CandidateStore,
  type ContactStore,
} from "@calebx/form";

export interface ProfileStores {
  candidates: CandidateStore;
  contacts: ContactStore;
}

export interface LoadedProfile {
  answers: Answers;
  createdAt: string;
  /** False for a user who has no row yet. */
  exists: boolean;
}

export async function loadProfile(
  stores: ProfileStores,
  userId: string,
): Promise<LoadedProfile> {
  const [candidate, contact] = await Promise.all([
    stores.candidates.get(userId),
    stores.contacts.get(userId),
  ]);

  return {
    answers: mergeAnswers(candidate?.answers ?? {}, contact?.answers ?? {}),
    createdAt: candidate?.createdAt ?? new Date().toISOString(),
    exists: candidate !== null,
  };
}

/**
 * Persists a full answer set.
 *
 * The contact tab is only touched when there is something to put in it, so a
 * user who abandons the form before the contact section never gets an empty row
 * in the sensitive tab.
 */
export async function saveProfile(
  stores: ProfileStores,
  userId: string,
  answers: Answers,
  createdAt: string,
): Promise<void> {
  const { candidate, contact } = splitAnswers(answers);
  const now = new Date().toISOString();

  await stores.candidates.set(userId, {
    userId,
    createdAt,
    updatedAt: now,
    consentGranted: true, // only reachable past the consent gate
    answers: candidate,
  });

  if (Object.keys(contact).length > 0) {
    await stores.contacts.set(userId, { userId, answers: contact });
  }
}

/** Erases everything the bot holds for a user. Never touches the Matches tab. */
export async function eraseProfile(
  stores: ProfileStores,
  userId: string,
): Promise<void> {
  await stores.candidates.delete(userId);
  await stores.contacts.delete(userId);
}
