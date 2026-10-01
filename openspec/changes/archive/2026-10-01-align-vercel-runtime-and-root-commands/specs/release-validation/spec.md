# Spec Delta

## Purpose

The runtime a deployment actually builds with, and the commands a developer runs to get
there. The first is a contract: a declared runtime that the target host cannot satisfy is not
a target, and nothing in the repository noticed until this was checked against the host's own
documentation. The second is ergonomics: the application lives in `frontend/`, and a
developer should not have to know that to start it.

## MODIFIED Requirements

### Requirement: The deployment contract is asserted

The application's deployable shape SHALL be asserted by checks rather than assumed, and SHALL
cover: a single application with no custom server and no request-interception hook; no
required environment variable; the response security policy declared where a CDN cannot remove
it rather than injected at the edge; and the service worker and manifest served as static files
whose caching does not prevent the worker's update flow.

The runtime the application is verified on SHALL be declared, and the declared runtime SHALL be
one the project's stated deployment target can actually build, with the CI workflow verifying
the same major, so that a host builds the thing that was tested rather than a thing that
merely resembles it.

#### Scenario: A shape that breaks single-application deployment fails a check

- **WHEN** a custom server or a request-interception hook is introduced
- **THEN** the deployment contract check fails, because either breaks the single
  deployable application the free tier depends on

#### Scenario: A required environment variable is introduced deliberately

- **WHEN** an environment variable becomes required for the application to run
- **THEN** the deployment contract check fails, because a required variable makes a
  deployment fail in a way nothing else would reveal until deployment

#### Scenario: A build uses a different runtime than the one verified

- **WHEN** the declared runtime and the runtime the CI workflow verifies are different majors
- **THEN** the deployment contract check fails, because the pin is then decorative and the
  host would build something other than the thing that was tested

#### Scenario: A runtime the deployment target cannot build fails a check

- **WHEN** the declared runtime names a major the stated deployment target does not offer
- **THEN** the deployment contract check fails and names the major and the supported set,
  because a build would otherwise fail on the target's own schedule rather than in this
  repository

#### Scenario: The check rejects a runtime the target cannot build

- **WHEN** the host-support check is proven
- **THEN** it is shown failing against every major the target does not offer, including the
  one this change replaced, so a check that cannot reject an unsupported pin is never mistaken
  for one that can

#### Scenario: The service worker can still update after deployment

- **WHEN** the deployment contract is checked
- **THEN** the service worker file is served as a static asset with caching that does not
  prevent a new worker from being fetched, because a long-lived cached worker is an
  application that cannot be updated

## ADDED Requirements

### Requirement: The application is reachable from the repository root

The repository root SHALL provide a manifest whose scripts run the application's commands, so
that a developer starting the application, testing it, or linting it does not first have to
change directory. The root manifest SHALL proxy to the application package and SHALL NOT
introduce a second dependency manifest, a second lockfile, or a workspace, and the application
directory SHALL remain where it is.

#### Scenario: The application starts from the repository root

- **WHEN** a developer runs the development command from the repository root
- **THEN** the application starts, and the command does not require a prior change of directory

#### Scenario: The root adds no second source of truth

- **WHEN** the root manifest is inspected
- **THEN** it declares no dependencies and the application package's lockfile remains the only
  one, so installing from the root cannot produce a manifest nothing installs from

#### Scenario: A root command reaches the application's own tooling

- **WHEN** a root command runs the formatter, the linter, or the type checker
- **THEN** it runs the application's configured tool over the application directory, and not a
  different command with a similar name

#### Scenario: Installation still has one correct path

- **WHEN** a developer is told how to install dependencies
- **THEN** there is one documented command that installs from the application lockfile, and it
  is reachable from the repository root, so the lockfile's location is not something a
  developer has to discover
