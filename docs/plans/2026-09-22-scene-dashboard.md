# Scene packet + dashboard

Chat, Laguna, and the player dashboard share one deterministic `CityScenePacket`.

1. Travel writes a named OSM instance.
2. Perceive (`look around`, `what is around me`, `where am I`) returns packet facts. No Jev clarification.
3. Dashboard Here/Around project the same packet (`discoverablePlaces`).
4. Names come from `entity_instances.state.name`, never the hashed UUID.

Stock and clerks stay absent until enter materializes family-stock/interiors.
