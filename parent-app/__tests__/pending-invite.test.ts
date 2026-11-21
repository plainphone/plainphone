// SPDX-License-Identifier: Apache-2.0
import { acceptedInvites, forgetAcceptedInvites } from "../src/lib/pendingInvite";

it("forgets which invitations were accepted, so the next account's request is really sent", () => {
  acceptedInvites.set("pp_i_token", Promise.resolve());
  forgetAcceptedInvites();
  expect(acceptedInvites.size).toBe(0);
});
