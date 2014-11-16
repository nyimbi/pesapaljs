/**
 *  Copyright (c) 2014 Salama AB
 *  All rights reserved
 *  Contact: aksalj@aksalj.me
 *  Website: http://www.aksalj.me
 *
 *  Project : pesapaljs
 *  File : app
 *  Date : 10/2/14 9:56 AM
 *  Description :
 *
 */
var express = require('express');
var morgan = require('morgan');
var bodyParser = require('body-parser');
var api = require('./api');
var db = require("./database");
var PesaPal = require('../../lib/pesapal');

var pesapal = new PesaPal({ debug: true, key: "cq4aoP7ROjqsosMYrP2Btftbm4TzHLoK", secret: "O6SQHlUHbIEhINtyUJxRTkCdqvw=" });
var app = express();

app.set('views', __dirname + '/view');
app.set('view engine', 'jade');

app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: false }));

// Serve our android app
api(app, pesapal);

app.use("/static", express.static(__dirname + "/static"));

app.get('/payment_listener', pesapal.paymentListener, function (req) {
    var payment = req.payment;
    if (payment) {
        // TODO: Save in DB?
    }
});

app.get('/payment_callback', function (req, res) {
    var options = { // Assumes pesapal calls back with a transaction id and reference
        transaction: req.query[PesaPal.Utils.getQueryKey('transaction')],
        reference: req.query[PesaPal.Utils.getQueryKey('reference')]
    };

    pesapal.paymentDetails(options, function (error, payment) {
        res.send({error: error, payment: payment});
    });
});

app.get('/checkout', function (req, res, next) {
    // TODO: Render checkout UI
    res.render("checkout", {
        reference: new Date().getTime(),
        description: "Order description",
        amount: Math.floor((Math.random() * 20000) + 1)
    });
});

app.post('/checkout', function (req, res, next) {
    // TODO: Make order from request;
    var customer = new PesaPal.Customer(req.body.email, "");
    customer.firstName = req.body.first_name;
    customer.lastName = req.body.last_name;
    var order = new PesaPal.Order(
        req.body.reference,
        customer,
        req.body.description,
        req.body.amount,
        "KES",
        req.body.type);


    if(req.body.pesapal) { // Redirect to PesaPal for payment

        var paymentURI = pesapal.getPaymentURL(order, "http://localhost:3000/payment_callback");
        res.redirect(paymentURI);

    } else { // Use Custom Payment Page

        var mobilePayment = req.body.mobile != undefined;
        var method = mobilePayment ? PesaPal.PaymentMethod.MPesa : PesaPal.PaymentMethod.Visa;

        pesapal.makeOrder(order, method, function (error, order) {

            if(error) {
                res.send(error.message);
            } else {

                // TODO: Save order in DB
                db.saveOrder(order);

                // TODO: Render UI to get mpesa transaction code or card details from user
                if (mobilePayment) {
                    res.render("mobile", {
                        reference: order.reference,
                        instructions: "Send " + order.amount + " " + order.currency + " to " + method.account + " via " + method.name
                    });
                } else {
                    res.render("card", {reference: order.reference});
                }
            }

        });
    }
});

app.post('/pay', function (req, res, next) {

    // TODO: Retrieve order from DB
    var order = db.getOrder(req.body.reference);

    var callback = function (error, reference, transactionId) {
        // TODO: Render Success / Error UI
        // TODO: Save transaction id for conformation when I get an IPN
        var message = transactionId == null ? error.message : "Thank you for doing business with us.";
        var details = null;
        if(transactionId) {
            details = "Ref #: " + reference + "  ";
            details += "Transaction ID: " + transactionId;
        }
        res.render("message", {message: message, details: details});
    };

    var paymentData = null;

    switch (order.getPaymentMethod()) {
        case PesaPal.PaymentMethod.MPesa:
        case PesaPal.PaymentMethod.Airtel:
            paymentData = new PesaPal.MobileMoney(req.body.phone, req.body.code);
            break;
        case PesaPal.PaymentMethod.Visa:
        case PesaPal.PaymentMethod.MasterCard:
            paymentData = new PesaPal.Card();
            paymentData.firstName = req.body.first_name;
            paymentData.lastName = req.body.last_name;
            paymentData.number = req.body.number.replace(/ /g, "");
            paymentData.cvv = req.body.cvv;
            paymentData.expirationMonth = (req.body.expiry.split('/') [0]).trim();
            paymentData.expirationYear = (req.body.expiry.split('/') [1]).trim();
            paymentData.country = req.body.country;
            paymentData.countryCode = req.body.country_code;
            paymentData.phone = req.body.phone;
            paymentData.email = req.body.email;
            break;
        default:
            throw new Error("Invalid order");
    }

    if(paymentData != null) {
        pesapal.payOrder(order, paymentData, callback);
    } else {
        res.render("message", {message: "Error!!!"});
    }

});

app.listen(3000);