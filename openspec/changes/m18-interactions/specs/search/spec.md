# Spec Delta

## ADDED Requirements

### Requirement: The search field offers suggestions as it is typed

The search field SHALL offer a suggestion list while a listener types, containing the refinements the
current query implies and the searches this device has made recently. The list SHALL be presented as a
combobox popup with a listbox of options, SHALL expose the active option programmatically, and SHALL be
fully operable from the keyboard: the up and down keys move the active option, a commit key accepts it,
and the dismissal key closes the list and returns focus to the field.

Suggestions SHALL be derived only from what the query and the local search history already contain. A
superseded suggestion request SHALL never render, and a cancelled one SHALL be discarded rather than
treated as a failure.

#### Scenario: Suggestions appear while typing

- **WHEN** a listener types into the search field
- **THEN** a listbox of suggestion options is offered beneath it

#### Scenario: The suggestion list is a combobox

- **WHEN** the suggestion list is open
- **THEN** the field declares itself a combobox and the active option is exposed by
  `aria-activedescendant`

#### Scenario: The keyboard moves and commits a suggestion

- **WHEN** the list is open and a navigation key is pressed, then a commit key
- **THEN** the active option moves, and committing it puts that suggestion into the field

#### Scenario: Dismissing returns focus to the field

- **WHEN** the dismissal key is pressed while the list is open
- **THEN** the list closes and focus is on the search field

#### Scenario: A superseded suggestion never renders

- **WHEN** a listener types again before the previous suggestion request answers
- **THEN** only the newest suggestion request may render, and the earlier one is discarded

#### Scenario: Suggestions come from the query and local history only

- **WHEN** suggestions are derived
- **THEN** they come from the typed query and this device's own recent searches, and no suggestion
  introduces a provider request

#### Scenario: An empty field offers recent searches

- **WHEN** the field is focused with no query
- **THEN** this device's recent searches are offered, and nothing is sent anywhere to obtain them

### Requirement: Suggestion behaviour leaves the existing search controller unchanged

The existing debounce, request cancellation, URL synchronisation, and local history recording of the
search controller SHALL behave exactly as they did before this milestone. Suggestions SHALL run on their
own debounce and their own cancellation, such that a suggestion request and a results request never
cancel one another and neither changes what the controller returns.

#### Scenario: The controller's public surface is unchanged

- **WHEN** the search controller is used
- **THEN** it returns the same surface and the same retry behaviour as before this milestone

#### Scenario: Suggestions do not cancel result requests

- **WHEN** a suggestion request is in flight and a results request starts
- **THEN** both proceed, and neither is aborted by the other

#### Scenario: URL synchronisation still follows the committed query

- **WHEN** a suggestion is committed
- **THEN** the URL updates exactly as it does for a typed query