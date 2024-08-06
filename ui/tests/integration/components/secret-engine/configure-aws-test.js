/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import sinon from 'sinon';
import { setupRenderingTest } from 'vault/tests/helpers';
import { GENERAL } from 'vault/tests/helpers/general-selectors';
import { SECRET_ENGINE_SELECTORS as SES } from 'vault/tests/helpers/secret-engine/secret-engine-selectors';
import { render, click, fillIn } from '@ember/test-helpers';
import { setupMirage } from 'ember-cli-mirage/test-support';
import { hbs } from 'ember-cli-htmlbars';
import { v4 as uuidv4 } from 'uuid';
import { overrideResponse } from 'vault/tests/helpers/stubs';
import {
  expectedConfigKeys,
  configUrl,
  fillInAwsConfig,
} from 'vault/tests/helpers/secret-engine/secret-engine-helpers';

module('Integration | Component | SecretEngine/configure-aws', function (hooks) {
  setupRenderingTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(function () {
    this.store = this.owner.lookup('service:store');
    this.flashMessages = this.owner.lookup('service:flash-messages');
    this.flashMessages.registerTypes(['success', 'danger']);
    this.flashSuccessSpy = sinon.spy(this.flashMessages, 'success');
    this.flashDangerSpy = sinon.spy(this.flashMessages, 'danger');
    this.transitionStub = sinon.stub(this.owner.lookup('service:router'), 'transitionTo');

    this.uid = uuidv4();
    this.id = `aws-${this.uid}`;
    this.rootConfig = this.store.createRecord('aws/root-config');
    this.leaseConfig = this.store.createRecord('aws/lease-config');
    // Add backend to the configs because it's not on the testing snapshot (would come from url)
    this.rootConfig.backend = this.leaseConfig.backend = this.id;

    this.renderComponent = () => {
      return render(hbs`
        <SecretEngine::ConfigureAws @rootConfig={{this.rootConfig}} @leaseConfig={{this.leaseConfig}} @id={{this.id}} />
        `);
    };
  });

  module('Create view', function () {
    test('it renders all the fields', async function (assert) {
      assert.expect(11);
      await this.renderComponent();
      assert.dom(SES.aws.configForm).exists('it lands on the aws configuration form.');
      assert.dom(SES.aws.accessTitle).exists('Access section is rendered');
      assert.dom(SES.aws.leaseTitle).exists('Lease section is rendered');
      await click(GENERAL.toggleGroup('Root config options'));
      // not ideal, would prefer to use helper to iterate, but problem with camelCase in some of the selectors and some without
      assert.dom(GENERAL.inputByAttr('accessKey')).exists(`accessKey shows for Access section.`);
      assert.dom(GENERAL.maskedInput('secretKey')).exists(`secretKey shows for Access section.`);
      assert.dom(GENERAL.inputByAttr('region')).exists(`region shows for Access section.`);
      assert.dom(GENERAL.inputByAttr('iamEndpoint')).exists(`iamEndpoint shows for Access section.`);
      assert.dom(GENERAL.inputByAttr('stsEndpoint')).exists(`stsEndpoint shows for Access section.`);
      assert.dom(GENERAL.inputByAttr('maxRetries')).exists(`maxRetries shows for Access section.`);
      for (const key of expectedConfigKeys('aws-lease')) {
        assert.dom(`[data-test-ttl-form-label="${key}"]`).exists(`${key} shows for Lease section.`);
      }
    });

    test('it shows validation error if default lease is entered but max lease is not', async function (assert) {
      assert.expect(2);
      await this.renderComponent();
      this.server.post(configUrl('aws-lease', this.id), () => {
        assert.false(
          true,
          'post request was made to config/lease when no data was changed. test should fail.'
        );
      });
      this.server.post(configUrl('aws', this.id), () => {
        assert.false(
          true,
          'post request was made to config/root when no data was changed. test should fail.'
        );
      });
      await click(GENERAL.ttl.toggle('Default Lease TTL'));
      await fillIn(GENERAL.ttl.input('Default Lease TTL'), '33');
      await click(SES.aws.save);
      assert
        .dom(GENERAL.inlineError)
        .hasText('Lease TTL and Max Lease TTL are both required if one of them is set.');
      assert.dom(SES.aws.configForm).exists('remains on the configuration form');
    });

    test('it shows validation error if access key is entered but secret key is not', async function (assert) {
      assert.expect(2);
      await this.renderComponent();
      this.server.post(configUrl('aws-lease', this.id), () => {
        assert.false(
          true,
          'post request was made to config/lease when no data was changed. test should fail.'
        );
      });
      this.server.post(configUrl('aws', this.id), () => {
        assert.false(
          true,
          'post request was made to config/root when no data was changed. test should fail.'
        );
      });
      await fillIn(GENERAL.inputByAttr('accessKey'), 'foo');
      await click(SES.aws.save);
      assert
        .dom(GENERAL.inlineError)
        .hasText('Access Key and Secret Key are both required if one of them is set.');
      assert.dom(SES.aws.configForm).exists('remains on the configuration form');
    });

    test('it surfaces the API error if one occurs on root/config, preventing user from transitioning', async function (assert) {
      assert.expect(3);
      await this.renderComponent();
      this.server.post(configUrl('aws', this.id), () => {
        return overrideResponse(400, { errors: ['bad request'] });
      });
      this.server.post(configUrl('aws-lease', this.id), () => {
        assert.true(true, 'post request was made to config/lease when config/root failed. test should pass.');
      });
      // fill in both lease and root endpoints to ensure that both payloads are attempted to be sent
      await fillInAwsConfig(true, false, true);
      await click(SES.aws.save);
      assert.dom(GENERAL.messageError).exists('API error surfaced to user');
      assert.dom(GENERAL.inlineError).exists('User shown inline error message');
    });

    test('it allows user to submit root config even if API error occurs on config/lease config', async function (assert) {
      assert.expect(3);
      await this.renderComponent();
      this.server.post(configUrl('aws', this.id), () => {
        assert.true(true, 'post request was made to config/root when config/lease failed. test should pass.');
      });
      this.server.post(configUrl('aws-lease', this.id), () => {
        return overrideResponse(400, { errors: ['bad request'] });
      });
      // fill in both lease and root endpoints to ensure that both payloads are attempted to be sent
      await fillInAwsConfig(true, false, true);
      await click(SES.aws.save);

      assert.true(
        this.flashDangerSpy.calledWith('Lease configuration was not saved: bad request'),
        'Flash message shows that lease was not saved.'
      );
      assert.ok(
        this.transitionStub.calledWith('vault.cluster.secrets.backend.configuration', this.id),
        'Transitioned to the configuration index route.'
      );
    });

    test('it transitions without sending a lease or root payload on cancel', async function (assert) {
      assert.expect(3);
      await this.renderComponent();
      this.server.post(configUrl('aws', this.id), () => {
        assert.true(
          false,
          'post request was made to config/root when user canceled out of flow. test should fail.'
        );
      });
      this.server.post(configUrl('aws-lease', this.id), () => {
        assert.true(
          false,
          'post request was made to config/lease when user canceled out of flow. test should fail.'
        );
      });
      // fill in both lease and root endpoints to ensure that both payloads are attempted to be sent
      await fillInAwsConfig(true, false, true);
      await click(SES.aws.cancel);

      assert.true(this.flashDangerSpy.notCalled, 'No danger flash messages called.');
      assert.true(this.flashSuccessSpy.notCalled, 'No success flash messages called.');
      assert.ok(
        this.transitionStub.calledWith('vault.cluster.secrets.backend.configuration', this.id),
        'Transitioned to the configuration index route.'
      );
    });
  });
});

// TODO: module edit
// ('it shows previously saved lease information and allows you to edit', async function (assert) {});
// ('it requires a double click to change the secret key', async function (assert) {});
// ('it sends lease payload if root was not changed', async function (assert) {});
// ('it sends root payload if lease was not changed', async function (assert) {});
// ('it transitions without sending a payload on cancel', async function (assert) {});
// FOR EACH: check transition, payload, and flashMessages.
