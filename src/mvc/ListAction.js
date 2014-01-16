/**
 * UB RIA Base
 * Copyright 2013 Baidu Inc. All rights reserved.
 * 
 * @ignore
 * @file 列表Action基类
 * @author otakustay, wangyaqiong(catkin2009@gmail.com)
 * @date $DATE$
 */
define(
    function (require) {
        var BaseAction = require('./BaseAction');
        var util = require('er/util');
        var u = require('underscore');
        var URL = require('er/URL');

        /**
         * 列表Action基类
         *
         * @param {string} [entityName] 负责的实体名称
         * @extends BaseAction
         * @constructor
         */
        function ListAction(entityName) {
            BaseAction.apply(this, arguments);
        }

        util.inherits(ListAction, BaseAction);

        ListAction.prototype.modelType = './ListModel';

        /**
         * 创建数据模型对象
         *
         * @param {Object} args 模型的初始化数据
         * @return {ListModel}
         * @override
         */
        ListAction.prototype.createModel = function (args) {
            // 把默认参数补回去，不然像表格的`orderBy`字段没值表格就不能正确显示
            u.defaults(args, this.defaultArgs);

            return BaseAction.prototype.createModel.apply(this, arguments);
        };

        /**
         * 默认查询参数
         * 
         * 如果某个参数与这里的值相同，则不会加到URL中
         * 
         * 发给后端时，会自动加上这里的参数
         *
         * @type {Object}
         */
        ListAction.prototype.defaultArgs = {};

        /**
         * 进行查询
         *
         * @param {Object} args 查询参数
         */
        ListAction.prototype.performSearch = function (args) {
            // 去除默认参数值
            var defaultArgs = u.extend(
                {}, 
                this.defaultArgs
            );
            args = require('../util').purify(args, defaultArgs);

            var event = this.fire('search', { args: args });
            if (!event.isDefaultPrevented()) {
                this.redirectForSearch(args);
            }
        };

        /**
         * 进行查询引起的重定向操作
         *
         * @param {Object} args 查询参数
         */
        ListAction.prototype.redirectForSearch = function (args) {
            var path = this.model.get('url').getPath();
            var url = URL.withQuery(path, args);
            this.redirect(url, { force: true });
        };

        /**
         * 查询的事件处理函数
         *
         * @param {Object} e 事件对象
         * @ignore
         */
        function search(e) {
            this.performSearch(e.args);
        }

        /**
         * 带上查询参数重新加载第1页
         *
         * @param {this} {ListAction} Action实例
         */
        function reloadWithSearchArgs() {
            var args = this.view.getSearchArgs();
            this.performSearch(args);
        }

        /**
         * 更新每页显示条数
         *
         * @param {Object} 事件对象
         * @ignore
         */
        function updatePageSize(e) {
            // 先请求后端更新每页显示条数，然后直接刷新当前页
            this.model.updatePageSize(e.pageSize)
                .then(u.bind(reloadWithSearchArgs, this));
        }

        /**
         * 批量修改事件处理
         *
         * @param {Object} 事件对象
         * @ignore
         */
        function batchModifyStatus(e) {
            var status = e.status;
            var items = this.view.getSelectedItems();
            var ids = u.pluck(items, 'id');
            var context = {
                items: items,
                ids: ids,
                status: status,
                statusName: e.statusName,
                command: e.command
            };

            if (this.requireAdviceFor(context)) {
                // 需要后端提示消息的，再额外加入用户确认的过程
                var action = e.statusName;
                action = action.charAt(0).toUpperCase() + action.substring(1);
                var adviceMethod = 'get' + action + 'Advice';

                this.model[adviceMethod](ids, items)
                    .then(u.bind(waitConfirmForAdvice, this, context))
                    .then(u.delegate(updateEntities, this, context));
            }
            else {
                updateEntities.call(this, context);
            }
        }

        /**
         * 批量更新实体状态
         *
         * @param {meta.BatchUpdateContext} context 批量操作的上下文对象
         */
        function updateEntities(context) {
            this.model[context.statusName](context.ids)
                .then(
                    u.bind(updateListStatus, this, context),
                    u.bind(this.notifyBatchFail, this, context)
                );
        }

        /**
         * 根据批量删除前确认
         *
         * @param {meta.BatchUpdateContext} context 批量操作的上下文对象
         */
        function waitConfirmForAdvice(context, advice) {
            var options = {
                title: context.command + this.getEntityDescription(),
                content: advice.message
            };
            return this.view.waitConfirm(options);
        }

        /**
         * 通知批量操作失败
         *
         * 默认提示用户“无法[操作名]部分或全部[实体名]”
         *
         * @param {meta.BatchUpdateContext} context 批量操作的上下文对象
         */
        ListAction.prototype.notifyBatchFail = function (context) {
            var entityDescription = this.getEntityDescription();
            this.view.alert(
                '无法' + context.command + '部分或全部' + entityDescription,
                context.command + entityDescription
            );
        };

        /**
         * 根据批量删除、启用的状态更新当前Action，默认行为为直接刷新当前的Action
         *
         * @param {meta.BatchUpdateContext} context 批量操作的上下文对象
         */
        function updateListStatus(context) {
            var toastMessage = context.command + '成功';
            this.view.showToast(toastMessage);

            var event = this.fire('statusupdate', context);
            if (!event.isDefaultPrevented()) {
                this.reload();
            }
        }

        /**
         * 检查指定批量操作是否需要后端提示消息，默认删除操作时要求提示用户确认
         *
         * @param {meta.BatchUpdateContext} context 批量操作的上下文对象
         * @return {boolean} 返回`true`表示需要提示用户
         */
        ListAction.prototype.requireAdviceFor = function (context) {
            return context.statusName === 'remove';
        };

        /**
         * 初始化交互行为
         *
         * @protected
         * @override
         */
        ListAction.prototype.initBehavior = function () {
            BaseAction.prototype.initBehavior.apply(this, arguments);
            this.view.on('search', u.bind(search, this));
            this.view.on('pagesizechange', u.bind(updatePageSize, this));
            this.view.on('batchmodify', u.bind(batchModifyStatus, this));
        };

        /**
         * 根据布局变化重新调整自身布局
         */
        ListAction.prototype.adjustLayout = function () {
            this.view.adjustLayout();
        };
        
        return ListAction;
    }
);
