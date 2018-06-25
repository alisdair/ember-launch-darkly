import resolver from './helpers/resolver';
import {
  setResolver
} from 'ember-qunit';

import 'ember-launch-darkly/test-support/helpers/with-variation';

setResolver(resolver);
