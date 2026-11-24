//! Git CLI access: running Git, parsing its output and performing actions.

mod actions;
mod branches;
mod conflicts;
mod history;
mod locate;
mod markers;
mod models;
mod operation;
mod patch;
mod process;
mod refs;
mod runner;
mod status;
pub mod validate;

pub use actions::{Action, LineOperation};
pub use branches::{child_folder, is_unc, local_branch_name};
pub use conflicts::{ConflictDocument, ConflictKind, DocumentState, OpenDecision, Side};
pub use history::{Scope, HISTORY_PAGE_SIZE};
pub use locate::git_executable;
pub use markers::{ChunkChoice, Segment};
pub use models::*;
pub use operation::{Operation, OperationState};
pub use patch::FilePatch;
pub use refs::folder_name;
pub use runner::{Git, RunOptions, DEFAULT_OUTPUT_LIMIT};
