# Twake Pages

Twake Pages is the wiki of Twake Workplace: people write pages, organized as trees in wikis, and find them again. It runs on its own or as the Pages tab of a TwakeSpace space.

## Language

### Wikis and people

**Wiki**:
A tree of pages shared by its members, each with a role.
_Avoid_: Space (TwakeSpace's word), book, collection, notebook

**Personal wiki**:
The wiki each person gets on first use, for their own notes. It is never shared.
_Avoid_: Private space, my space

**Shared wiki**:
A wiki a person created and shares with chosen people of their organization, or with B2C users when they are one.
_Avoid_: Team wiki, group wiki

**Space wiki**:
The wiki of a TwakeSpace space. Its name and its members come from the space, never from Pages.
_Avoid_: Managed wiki, linked wiki

**Member**:
A person with a role on a wiki: viewer, editor or admin.
_Avoid_: Participant, collaborator, user (in the domain)

**Viewer**:
A member who reads pages, comments, follows and keeps favorites.

**Editor**:
A member who also writes, publishes, moves, deletes and restores pages.
_Avoid_: Contributor, writer

**Admin**:
A member who also renames the wiki, manages its members, and empties its trash.
_Avoid_: Owner, manager

**Invitation**:
A role given to an email that has not signed in yet. It becomes a membership when that email signs in.
_Avoid_: Pending member, guest

### Pages

**Page**:
A titled document made of blocks, placed in a wiki's tree under another page or at its top.
_Avoid_: Document, article, note, doc

**Home page**:
The page a wiki opens on. Every wiki has exactly one, outside the tree: it has no parent and no children, and is never moved or deleted.
_Avoid_: Overview, index, root page, landing page

**Child page**:
A page placed under another page, its parent.
_Avoid_: Sub-page, sub-document

**Tree**:
The arrangement of a wiki's pages, each with its parent and its place among its siblings.
_Avoid_: Hierarchy, outline, sidebar

**Database**:
A page that shows a Grist document instead of blocks.
_Avoid_: Table, sheet, Grist page

**Block**:
One piece of a page's content: a paragraph, a heading, a list item, a table, an image, a Grist embed.
_Avoid_: Element, node, paragraph (for any block)

**Grist embed**:
A block that shows a Grist document, or one of its pages, inside a page.
_Avoid_: Grist widget, Grist block

**Template**:
The content a new page starts from, chosen when it is created: meeting notes, a decision, a how-to.
_Avoid_: Blueprint, model

**Label**:
A word given to pages of a wiki to group them across the tree.
_Avoid_: Tag, category, keyword

### Writing and history

**Draft**:
Changes made in the editor and not published yet. It is private to the person editing and stays in their browser.
_Avoid_: Unsaved changes, working copy

**Publishing**:
Making a draft the page's content for everyone, which records a new version.
_Avoid_: Saving, committing, updating (for this act)

**Version**:
A published state of a page's title and content, numbered from 1.
_Avoid_: Revision, snapshot, history entry

**Edit conflict**:
Publishing a draft started from a version older than the page's current one.
_Avoid_: Merge conflict, collision

**Restoring a version**:
Publishing a past version's title and content again, as a new version.
_Avoid_: Reverting, rollback

**Trash**:
Where a wiki keeps its deleted pages for 30 days, after which they are purged.
_Avoid_: Bin, archive, recycle bin

**Deleted page**:
A page in the trash, with every child page it had when it was deleted. Restoring it brings them back together.
_Avoid_: Archived page

### Following and finding

**Comment**:
A message about a page from one of its wiki's members, or a reply to one.
_Avoid_: Note, remark, discussion

**Mention**:
An email address written after `@` in a comment, which notifies that member.
_Avoid_: Tag, ping

**Follower**:
A person told about new versions of and comments on a page. Writing, publishing, commenting on or being mentioned in a page makes a person its follower, until they stop following it.
_Avoid_: Watcher, subscriber

**Notification**:
A message in Pages telling a person about a page they follow or were mentioned on, with its reason.
_Avoid_: Alert, activity (TwakeSpace's feed is the activity)

**Favorite**:
A page a person marked to find it again quickly.
_Avoid_: Star, bookmark, pin

**Recent page**:
A page the person opened lately.
_Avoid_: History (that word is for versions)

## Relationships

- A **Wiki** has one **Home page** and any number of other **Pages**; a **Page** belongs to exactly one **Wiki**.
- A **Page** has at most one parent; the **Tree** is made of parents and siblings, and the **Home page** is outside it.
- A **Space wiki** belongs to exactly one TwakeSpace space; a space has at most one **Space wiki**.
- A **Page** has one or more **Versions**; its current content is its last **Version**.
- A **Label** belongs to one **Wiki** and is given to any of its **Pages**.
- A **Member**'s role applies to every **Page** of the **Wiki**.

## Example dialogue

> **Dev:** "When Bob is removed from the space, what happens to the pages he wrote in its **Space wiki**?"
> **Domain expert:** "They stay, under his email. He stops being a **Member**, so he loses access and stops getting **Notifications**, even for the **Pages** he **follows**."
> **Dev:** "And if Alice deletes a page that has child pages?"
> **Domain expert:** "The whole branch goes to the **Trash** as one **Deleted page**. Restoring it brings the branch back under its parent, after its siblings, or to the top level of the **Tree**, last, if its parent is gone."

## Flagged ambiguities

- "Space" meant both a Confluence space and a TwakeSpace space. Resolved: Pages says **Wiki**; "space" only ever means a TwakeSpace space.
- "Save" was used both for keeping a **Draft** and for **Publishing**. Resolved: drafts are kept automatically, and only **Publishing** changes the page.
- "Archive" was used for deleted pages. Resolved: deleted pages are in the **Trash**; Pages has no archive yet.
