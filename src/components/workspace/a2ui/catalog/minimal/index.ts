import { Button } from "./components/Button";
import { ChildList } from "./components/ChildList";
import { Column } from "./components/Column";
import { Row } from "./components/Row";
import { Text } from "./components/Text";
import { TextField } from "./components/TextField";

export const minimalCatalogId =
  "https://a2ui.org/specification/v0_9/catalogs/minimal/minimal_catalog.json";

export const minimalCatalog = {
  catalogId: minimalCatalogId,
  components: {
    Button,
    ChildList,
    Column,
    Row,
    Text,
    TextField,
  },
} as const;

export { Button, ChildList, Column, Row, Text, TextField };
