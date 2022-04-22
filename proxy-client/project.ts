// Copyright © 2021 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3
// with Radicle Linking Exception. For full terms see the included
// LICENSE file.

import * as zod from "zod";
import type { Fetcher, RequestOptions } from "./fetcher";
import { Identity, identitySchema } from "./identity";

export interface Metadata {
  name: string;
  defaultBranch: string;
  description: string | null;
  delegates: string[];
}

const metadataSchema: zod.Schema<Metadata> = zod.object({
  name: zod.string(),
  defaultBranch: zod.string(),
  description: zod.string().nullable(),
  delegates: zod.array(zod.string()),
});

export interface CreateParams {
  repo: NewRepo | ExistingRepo;
  description?: string;
  defaultBranch: string;
}

export interface Project {
  urn: string;
  metadata: Metadata;
  stats: Stats;
  seed: string | null;
}

const projectSchema: zod.Schema<Project> = zod.object({
  urn: zod.string(),
  metadata: metadataSchema,
  stats: zod.object({
    branches: zod.number(),
    commits: zod.number(),
    contributors: zod.number(),
  }),
  seed: zod.string().nullable(),
});

export interface FailedProject {
  urn: string;
  metadata: Metadata;
}

const failedProjectSchema: zod.Schema<FailedProject> = zod.object({
  urn: zod.string(),
  metadata: metadataSchema,
});

export interface Stats {
  branches: number;
  commits: number;
  contributors: number;
}

interface NewRepo {
  type: "new";
  path: string;
  name: string;
}

interface ExistingRepo {
  type: "existing";
  path: string;
}

export enum RequestStatus {
  Created = "created",
  Requested = "requested",
  Found = "found",
  Cloning = "cloning",
  Cloned = "cloned",
  Cancelled = "cancelled",
  Failed = "failed",
  TimedOut = "timedOut",
}

export interface Request {
  type: RequestStatus;
  urn: string;
}

const requestSchema = zod.object({
  type: zod.enum([
    RequestStatus.Created,
    RequestStatus.Requested,
    RequestStatus.Found,
    RequestStatus.Cloning,
    RequestStatus.Cloned,
    RequestStatus.Cancelled,
    RequestStatus.Failed,
    RequestStatus.TimedOut,
  ]),
  urn: zod.string(),
});

export interface Peer {
  type: PeerType;
  peerId: string;
  status: PeerReplicationStatus;
}

export enum PeerType {
  Local = "local",
  Remote = "remote",
}

export enum PeerRole {
  Contributor = "contributor",
  Delegate = "delegate",
  Tracker = "tracker",
}

export enum PeerReplicationStatusType {
  NotReplicated = "notReplicated",
  Replicated = "replicated",
}

export interface PeerNotReplicated {
  type: PeerReplicationStatusType.NotReplicated;
}

export interface PeerReplicated {
  type: PeerReplicationStatusType.Replicated;
  role: PeerRole;
  user: Identity;
}

export type PeerReplicationStatus = PeerNotReplicated | PeerReplicated;

const peerSchema: zod.Schema<Peer> = zod.object({
  type: zod.enum([PeerType.Local, PeerType.Remote]),
  peerId: zod.string(),
  status: zod.union([
    zod.object({
      type: zod.literal(PeerReplicationStatusType.NotReplicated),
    }),
    zod.object({
      type: zod.literal(PeerReplicationStatusType.Replicated),
      role: zod.enum([
        PeerRole.Tracker,
        PeerRole.Delegate,
        PeerRole.Contributor,
      ]),
      user: identitySchema,
    }),
  ]),
});

export interface Patch {
  id: string;
  peer: Peer;
  message: string | null;
  commit: string;
  mergeBase: string | null;
}

const patchSchema: zod.ZodSchema<Patch> = zod.object({
  id: zod.string(),
  peer: peerSchema,
  message: zod.string().nullable(),
  commit: zod.string(),
  mergeBase: zod.string().nullable(),
});

export class Client {
  private fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  public async create(params: CreateParams): Promise<Project> {
    return this.fetcher.fetchOk(
      {
        method: "POST",
        path: "projects",
        body: params,
      },
      projectSchema
    );
  }

  public async get(urn: string): Promise<Project> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: `projects/${urn}`,
      },
      projectSchema
    );
  }

  public async listFailed(): Promise<FailedProject[]> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: "projects/failed",
      },
      zod.array(failedProjectSchema)
    );
  }

  public async listTracked(): Promise<Project[]> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: "projects/tracked",
      },
      zod.array(projectSchema)
    );
  }

  public async listContributed(): Promise<Project[]> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: "projects/contributed",
      },
      zod.array(projectSchema)
    );
  }

  public async listForUser(userUrn: string): Promise<Project[]> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: `projects/user/${userUrn}`,
      },
      zod.array(projectSchema)
    );
  }
  public async requestsList(): Promise<Request[]> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: `projects/requests/`,
      },
      zod.array(requestSchema)
    );
  }

  public async requestCancel(urn: string): Promise<void> {
    return this.fetcher.fetchOkNoContent({
      method: "DELETE",
      path: `projects/requests/${urn}`,
    });
  }

  public async requestSubmit(projectUrn: string): Promise<Request> {
    return this.fetcher.fetchOk(
      {
        method: "PUT",
        path: `projects/requests/${projectUrn}`,
      },
      requestSchema
    );
  }

  public async listPeers(
    projectUrn: string,
    options?: RequestOptions
  ): Promise<Peer[]> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: `projects/${projectUrn}/peers`,
        options,
      },
      zod.array(peerSchema)
    );
  }

  public async peerTrack(urn: string, peerId: string): Promise<boolean> {
    return this.fetcher.fetchOk(
      {
        method: "PUT",
        path: `projects/${urn}/track/${peerId}`,
      },
      zod.boolean()
    );
  }

  public async peerUntrack(urn: string, peerId: string): Promise<boolean> {
    return this.fetcher.fetchOk(
      {
        method: "PUT",
        path: `projects/${urn}/untrack/${peerId}`,
      },
      zod.boolean()
    );
  }

  public async patchList(projectUrn: string): Promise<Patch[]> {
    return this.fetcher.fetchOk(
      {
        method: "GET",
        path: `projects/${projectUrn}/patches`,
      },
      zod.array(patchSchema)
    );
  }

  public async publishPatchEvent(
    projectUrn: string,
    // Patch ID starts with the remote peer ID and has the form
    // `<origin per id>/<patch name>`
    patchId: string,
    event: PatchEvent
  ): Promise<void> {
    return this.fetcher.fetchOkNoContent({
      method: "PUT",
      path: `projects/${projectUrn}/patches/${patchId}/events`,
      body: event,
    });
  }

  public async patchEvents(
    projectUrn: string,
    patchId: string
  ): Promise<PatchEventEnvelope[]> {
    const response = await this.fetcher.fetch({
      method: "GET",
      path: `projects/${projectUrn}/patches/${patchId}/events`,
    });

    const responseBody = await response.json();

    if (!Array.isArray(responseBody)) {
      throw new Error("Expected array from GET events");
    }

    const events: PatchEventEnvelope[] = [];

    responseBody.forEach((e: unknown) => {
      const parsed = storedPatchEventSchema.safeParse(e);

      if (parsed.success) {
        events.push(parsed.data);
      }
    });

    return events;
  }
}

export interface PatchEventEnvelope {
  peer_id: string;
  event: PatchEvent;
}

export enum PatchStatus {
  Closed = "closed",
  Open = "open",
  Merged = "merged",
}

export enum PatchEventType {
  SetStatus = "setStatus",
}

type PatchEvent =
  | {
      type: PatchEventType.SetStatus;
      data: { status: PatchStatus.Open | PatchStatus.Closed };
    }
  | { type: "foo" };

const patchEventSchema: zod.Schema<PatchEvent> = zod.union([
  zod.object({
    type: zod.literal(PatchEventType.SetStatus),
    data: zod.object({
      status: zod.enum([PatchStatus.Open, PatchStatus.Closed]),
    }),
  }),
  zod.object({ type: zod.literal("foo") }),
]);

const storedPatchEventSchema: zod.Schema<PatchEventEnvelope> = zod.object({
  peer_id: zod.string(),
  event: patchEventSchema,
});
