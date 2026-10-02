# Spec Delta

## Purpose

One motion vocabulary for the whole application, expressed once in CSS; every motion reduced-motion
safe by construction rather than by remembering; and a written, measured decision that motion costs no
client JavaScript.

## ADDED Requirements

### Requirement: One motion vocabulary, declared once

The application SHALL define its motion timings in a single place as CSS custom properties, and every
motion in the application SHALL use one of those declared values. A duration, easing, or travel distance
written anywhere else is a defect, and a component SHALL NOT introduce its own.

The vocabulary SHALL be limited to a small set of named steps, so that a motion is recognisable as
belonging to the system rather than to a component.

#### Scenario: The vocabulary is declared in one place

- **WHEN** the application's motion values are inspected
- **THEN** every duration, easing, and travel distance is a named step declared once, in one module

#### Scenario: No component invents a duration

- **WHEN** every source file declaring a `transition` or `animation` is inspected
- **THEN** every duration literal used is one of the declared vocabulary steps

#### Scenario: The vocabulary is small

- **WHEN** the declared steps are counted
- **THEN** there is a bounded number of them, so the set is a vocabulary rather than a catalogue

#### Scenario: Motion is declared only on animatable properties

- **WHEN** the properties the vocabulary transitions are inspected
- **THEN** they are opacity and transform, so no transition in the application triggers layout

### Requirement: Every motion has a reduced-motion path

The application SHALL neutralise animation and transition under `prefers-reduced-motion: reduce`, and
every motion SHALL be reachable without animating. A motion SHALL NOT be the only way a piece of
information is conveyed, and a surface SHALL NOT become unusable when its motion is removed.

This SHALL hold by construction — the reduced-motion rule collapsing the declared durations — rather than
by each motion declaring its own gate.

#### Scenario: The preference collapses every motion

- **WHEN** the application is presented with a reduced-motion preference
- **THEN** animations and transitions are neutralised application-wide, without any per-component opt-out

#### Scenario: A motion is never load-bearing

- **WHEN** a motion is not played
- **THEN** the same information is presented, and every affected control remains operable

#### Scenario: The reduced-motion rule cannot be narrowed by a component

- **WHEN** a source file is inspected for its own reduced-motion handling
- **THEN** no component defines one, because the application-level rule already covers it

### Requirement: Motion is scoped to named surfaces, and is added where it earns its place

The application SHALL animate shelf and card entrances, hover and tap feedback, dialog and sheet
transitions, player and Now Playing transitions, and Home's content changes. It SHALL NOT animate
everything: a surface outside that set SHALL NOT be animated merely for consistency.

Motion SHALL never block input, SHALL never be required to complete an action, and SHALL NOT run on a
loop for decoration.

#### Scenario: The named surfaces carry motion

- **WHEN** each surface named by the milestone is rendered
- **THEN** it carries a transition drawn from the vocabulary

#### Scenario: Nothing else is animated

- **WHEN** a surface outside the named set is rendered
- **THEN** it declares no motion, so the milestone is not a programme of animating everything

#### Scenario: Input is never blocked by motion

- **WHEN** a motion is in progress
- **THEN** the controls it belongs to remain operable, and no action waits for it to finish

#### Scenario: Motion never loops

- **WHEN** motion is inspected for repetition
- **THEN** no motion repeats indefinitely, and none runs as decoration

### Requirement: Motion costs no client JavaScript

The application's motion SHALL be expressed in CSS and SHALL add no client-side animation library. The
measured client bundle SHALL NOT grow as a result of this milestone, and that budget SHALL be asserted
rather than remembered.

A future requirement for a spring or a gesture-following animation SHALL NOT be met by adding a dependency
without re-measuring the cost and recording the decision again.

#### Scenario: The bundle budget holds

- **WHEN** the emitted client chunks are measured, gzipped
- **THEN** the total is no larger than the recorded baseline, and no animation library is among the
  dependencies

#### Scenario: The recorded baseline is the measured one

- **WHEN** the bundle budget is asserted
- **THEN** the figure it compares against is the measured pre-milestone total, not an estimate

#### Scenario: Adding a library is a visible change

- **WHEN** a client-side animation library is added to the manifest
- **THEN** the budget check fails, so the decision cannot be made silently