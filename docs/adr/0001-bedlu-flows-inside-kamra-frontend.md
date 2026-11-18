# Bedlu flows live inside Kamra's frontend, on an unchanged Kamra backend

We port Bedlu's front-desk experience into this Kamra fork one flow at a time, as new files inside Kamra's existing React app (`frontend/`), built from Kamra's own components and styling and calling only Kamra's existing APIs. Each Bedlu flow fully replaces its Kamra counterpart at the entry points, but Kamra's original files stay in the repo unused, and no Python under `kamra/` is changed. This keeps merges from upstream Kamra cheap while the screens change completely.

## Considered Options

- **Separate Bedlu React app (plan.md "option C") with the Bedlu visual system.** Rejected for now: it means rebuilding everything Kamra's app already does before any flow ships.
- **Rewrite Kamra's files in place.** Rejected: upstream releases keep editing those files, so every merge would conflict.
- **Small backend changes when a flow needs them.** Rejected: any capability Kamra's API lacks is dropped from the flow and filed as an issue instead.

## Consequences

- Kamra's backend rules are the floor. A Bedlu screen may be stricter than Kamra, never looser.
- Bedlu's visual system (7 Nov 2026 decision) is deferred; flows use Kamra's look.
- Optional Kamra fields that Bedlu doesn't show are hidden. Required ones are settled per flow in a field mapping approved before coding.
