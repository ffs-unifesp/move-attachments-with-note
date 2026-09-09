# Move Attachments With Note

This context covers the relationship between vault artifacts and the Markdown notes that accompany them.

## Language

**Source file**:
A non-Markdown file in the vault that a companion note describes or embeds.
_Avoid_: Original file, attachment

**Companion note**:
A Markdown note whose scalar `source` property contains a single internal link that resolves unambiguously to its source file. Its creator, filename, location, and body do not determine the association.
_Avoid_: Sidecar, companion file

**Companion note model**:
A Markdown note selected from anywhere in the vault whose properties and body provide the starting content for newly created companion notes.
_Avoid_: Global template, Templates folder

**Eligible file**:
A source file that can receive a companion note; folders and Markdown files are ineligible.
_Avoid_: Attachment type, supported format

**Ambiguous association**:
A state in which more than one companion note declares the same source file. No companion is selected while the association remains ambiguous.
_Avoid_: Duplicate note
