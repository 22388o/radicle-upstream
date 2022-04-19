// Copyright © 2022 The Radicle Upstream Contributors
//
// This file is part of radicle-upstream, distributed under the GPLv3
// with Radicle Linking Exception. For full terms see the included
// LICENSE file.

#![allow(clippy::unwrap_used)]

// TODO
// * make functions non-blocking
// * use self-describing commit message using trailers
// * sign and verify envelopess

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Envelope {
    pub peer_id: librad::PeerId,
    pub event: serde_json::Value,
}
// TODO Update signed_refs
pub fn write(
    this_peer_id: librad::PeerId,
    repo: &git2::Repository,
    identity: &link_identities::git::Urn,
    log_name: &str,
    payload: impl serde::Serialize,
) -> anyhow::Result<()> {
    // TODO add to signed refs
    // TODO use namespace facilities from librad
    let namespace_id = identity.encode_id();
    // TODO validate log_name
    let log_ref_name = format!("refs/namespaces/{namespace_id}/refs/notes/upstream/{log_name}");
    let prev_commit = match repo.find_reference(&log_ref_name) {
        Ok(log_ref) => {
            let prev_commit_id = log_ref.target().unwrap();
            Some(repo.find_commit(prev_commit_id).unwrap())
        },
        Err(err) => {
            if err.code() == git2::ErrorCode::NotFound {
                None
            } else {
                panic!("{}", err);
            }
        },
    };

    let envelope = Envelope {
        peer_id: this_peer_id,
        event: serde_json::to_value(&payload).unwrap(),
    };
    let message = serde_json::to_string(&envelope).unwrap();
    // TODO use tree from previous commit
    let treebuilder = repo.treebuilder(None).unwrap();
    let tree_oid = treebuilder.write().unwrap();
    let tree = repo.find_tree(tree_oid).unwrap();
    let signature = repo.signature().unwrap();
    repo.commit(
        Some(&log_ref_name),
        &signature,
        &signature,
        &message,
        &tree,
        &prev_commit.iter().collect::<Vec<_>>(),
    )
    .unwrap();
    Ok(())
}

// TODO use iterator
pub fn read(
    repo: &git2::Repository,
    identity: &link_identities::git::Urn,
    log_name: &str,
) -> anyhow::Result<Vec<Envelope>> {
    let namespace_id = identity.encode_id();
    let my_log_ref_name = format!("refs/namespaces/{namespace_id}/refs/notes/upstream/{log_name}");
    let remote_log_ref_glob =
        format!("refs/namespaces/{namespace_id}/refs/remotes/*/notes/upstream/{log_name}");

    let mut revwalk = repo.revwalk().unwrap();
    if let Err(err) = revwalk.push_ref(&my_log_ref_name) {
        // We check the message instead of `err.code()` because the code is
        // `git2::ErrorCode::Generic`.
        if !err.message().ends_with("not found") {
            panic!("{}", err)
        }
    }
    revwalk.push_glob(&remote_log_ref_glob).unwrap();

    let envelopes = revwalk.map(|oid_result| {
        let oid = oid_result.unwrap();
        let commit = repo.find_commit(oid).unwrap();
        serde_json::from_slice::<Envelope>(commit.message_bytes()).unwrap()
    });
    Ok(envelopes.collect::<Vec<_>>())
}

#[cfg(test)]
mod test {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn test_write() {
        // TODO use librad peer
        let temp_dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init_bare(&temp_dir).unwrap();
        let peer_id = librad::PeerId::from(link_crypto::SecretKey::new());
        let urn = link_identities::git::Urn::new(git2::Oid::zero().into());
        let log_name = "asdf";

        let read_events = read(&repo, &urn, log_name).unwrap();

        assert!(read_events.is_empty());

        let events = (1..10u32).collect::<Vec<_>>();

        for event in &events {
            write(peer_id, &repo, &urn, log_name, event).unwrap();
        }

        let read_events = read(&repo, &urn, log_name)
            .unwrap()
            .into_iter()
            .map(|wrapper| serde_json::from_value::<u32>(wrapper.event).unwrap())
            .rev()
            .collect::<Vec<_>>();

        assert_eq!(read_events, events);
    }

    // #[test]
    fn test_write_paralell() {
        // TODO use librad peer
        let temp_dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init_bare(&temp_dir).unwrap();
        let peer_id = librad::PeerId::from(link_crypto::SecretKey::new());
        let urn = link_identities::git::Urn::new(git2::Oid::zero().into());
        let log_name = "asdf";

        let events = vec![true; 16];

        let parallel = easy_parallel::Parallel::new();
        parallel
            .each(events.iter(), |event| {
                let repo = git2::Repository::open(&temp_dir).unwrap();
                write(peer_id, &repo, &urn, log_name, event).unwrap()
            })
            .run();
        let read_events = read(&repo, &urn, log_name)
            .unwrap()
            .into_iter()
            .map(|wrapper| serde_json::from_value::<bool>(wrapper.event).unwrap())
            .rev()
            .collect::<Vec<_>>();

        assert_eq!(read_events, events);
    }
}
