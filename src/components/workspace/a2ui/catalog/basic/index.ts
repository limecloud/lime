import { AudioPlayer } from "./components/AudioPlayer";
import { Button } from "./components/Button";
import { Card } from "./components/Card";
import { CheckBox } from "./components/CheckBox";
import { ChildList } from "./components/ChildList";
import { ChoicePicker } from "./components/ChoicePicker";
import { Column } from "./components/Column";
import { DateTimeInput } from "./components/DateTimeInput";
import { Divider } from "./components/Divider";
import { Icon } from "./components/Icon";
import { Image } from "./components/Image";
import { List } from "./components/List";
import { Modal } from "./components/Modal";
import { Row } from "./components/Row";
import { Slider } from "./components/Slider";
import { Tabs } from "./components/Tabs";
import { Text } from "./components/Text";
import { TextField } from "./components/TextField";
import { Video } from "./components/Video";

export const basicCatalogId =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

export const basicCatalog = {
  catalogId: basicCatalogId,
  components: {
    AudioPlayer,
    Button,
    Card,
    CheckBox,
    ChildList,
    ChoicePicker,
    Column,
    DateTimeInput,
    Divider,
    Icon,
    Image,
    List,
    Modal,
    Row,
    Slider,
    Tabs,
    Text,
    TextField,
    Video,
  },
} as const;

export {
  AudioPlayer,
  Button,
  Card,
  CheckBox,
  ChildList,
  ChoicePicker,
  Column,
  DateTimeInput,
  Divider,
  Icon,
  Image,
  List,
  Modal,
  Row,
  Slider,
  Tabs,
  Text,
  TextField,
  Video,
};
