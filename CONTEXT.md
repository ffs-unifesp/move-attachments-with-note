# Move Attachments With Note

This context covers notes created from selected vault files and the attachments that move with notes.

## Language

**Selected file**:
A non-Markdown file chosen as input when creating a linked note.
_Avoid_: Source file, original file

**Linked note**:
A newly created Markdown note that embeds one or more selected files in its body. Obsidian backlinks expose the relationship; the plugin does not assign it a separate identity.
_Avoid_: Companion note, collection note

**Linked note model**:
A Markdown note selected from anywhere in the vault whose properties and body provide the starting content for linked notes.
_Avoid_: Global template, Templates folder

**Eligible file**:
A file that can be selected for a linked note; folders and Markdown files are ineligible.
_Avoid_: Attachment type, supported format
