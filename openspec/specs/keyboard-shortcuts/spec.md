# keyboard-shortcuts Specification

## Purpose

Global keyboard shortcuts that drive playback and library actions without reaching for the player bar,
a discoverable help surface listing every binding, and a single definition of when a key already means
something local so a global handler can never override it.

## Requirements

### Requirement: A global shortcut cannot override a key that has local meaning

The application SHALL treat a keypress as belonging to the focused element whenever that element is a
text entry, a numeric or selection widget, a dialog, or a menu, and a global shortcut SHALL NOT fire in
that case. This SHALL be one shared definition rather than a per-handler check, SHALL be decidable from
the event target alone without inspecting application state, and SHALL cover an input, a textarea, a
select, a `contenteditable` element, a slider, a spinbutton, a dialog subtree, and a menu subtree.

#### Scenario: No shortcut fires while a text field has focus

- **WHEN** a global key is pressed while a text input, textarea, or select has focus
- **THEN** no global shortcut fires, and the field receives the key normally

#### Scenario: No shortcut fires inside editable content

- **WHEN** a global key is pressed while a `contenteditable` element has focus
- **THEN** no global shortcut fires, and the editable content receives the key

#### Scenario: Read-only editable content does not suppress shortcuts

- **WHEN** an element carries `contenteditable="false"`
- **THEN** it is treated as not editable, and shortcuts are not suppressed by it

#### Scenario: A modified key never fires a shortcut

- **WHEN** a global key is pressed together with the control, command, or alt modifier
- **THEN** no global shortcut fires, because that chord belongs to the browser or the operating system

#### Scenario: A shifted key still fires its shortcut

- **WHEN** a global key is pressed with the shift modifier held
- **THEN** the shortcut fires, because the help key is itself a shifted character

#### Scenario: A slider keeps its own arrow keys

- **WHEN** an arrow key is pressed while a slider has focus
- **THEN** the slider handles the key, and no seek or volume shortcut fires

#### Scenario: A dialog keeps its own dismissal

- **WHEN** a key is pressed while a dialog is open
- **THEN** the dialog handles it, and the global handler does not act a second time

#### Scenario: A menu keeps its own dismissal

- **WHEN** the dismissal key is pressed while a menu is open
- **THEN** the menu closes itself exactly once

#### Scenario: The guard is decidable from the target alone

- **WHEN** the guard is asked about an element
- **THEN** its answer depends only on that element's role and tags, not on application state

### Requirement: Global playback and library shortcuts

The application SHALL provide application-level bindings for play/pause, seeking, volume, mute,
liking the now-playing track, and opening help. Playback bindings SHALL act through the player's own
store actions rather than by writing state directly. A binding SHALL fire only when no control, command,
or alt modifier is held, and SHALL fire when shift is held. Raising the volume of a muted player SHALL
unmute it, so that no binding appears to do nothing. Seeking SHALL be bounded to the current track.

#### Scenario: Play and pause toggle

- **WHEN** the play/pause key is pressed and no key has local meaning
- **THEN** playback toggles between playing and paused

#### Scenario: Seeking moves within the current track

- **WHEN** a seek key is pressed
- **THEN** the position moves by the documented step, clamped to the track's bounds

#### Scenario: Volume adjusts in steps

- **WHEN** a volume key is pressed
- **THEN** the volume changes by the documented step, clamped to its own bounds

#### Scenario: Mute uses the player's real muted state

- **WHEN** the mute key is pressed
- **THEN** the player's muted state toggles, and the listener's volume itself is unchanged

#### Scenario: Raising volume while muted unmutes

- **WHEN** the volume is raised while the player is muted
- **THEN** the player is unmuted as well as louder

#### Scenario: The like key acts on the now-playing track

- **WHEN** the like key is pressed with a track playing
- **THEN** that track's liked state is toggled

#### Scenario: The like key does nothing with no track playing

- **WHEN** the like key is pressed with no track playing
- **THEN** nothing is liked or unliked

### Requirement: A discoverable shortcut help surface

The application SHALL provide a help surface listing every global binding, reachable by pointer as well
as by key. It SHALL render as a modal dialog with an accessible name, SHALL move focus inside on open,
SHALL keep keyboard focus within itself while open, and SHALL restore focus to whatever had it before on
close.

#### Scenario: Help opens from the keyboard and lists every binding

- **WHEN** the help key is pressed
- **THEN** a dialog opens listing every global binding

#### Scenario: Help is reachable by pointer

- **WHEN** a listener activates a visible control that opens help
- **THEN** the same dialog opens

#### Scenario: Focus is trapped while help is open

- **WHEN** focus is inside the help dialog and the listener presses the focus-cycle key
- **THEN** focus stays within the dialog rather than reaching the page behind it

#### Scenario: Focus returns to the invoking element

- **WHEN** the help dialog closes
- **THEN** focus returns to the element that opened it

#### Scenario: Help dismisses by key, by button, and by pointer

- **WHEN** the dialog is dismissed by the dismissal key, by its close control, or by activating the
  backdrop
- **THEN** it closes exactly once and restores focus